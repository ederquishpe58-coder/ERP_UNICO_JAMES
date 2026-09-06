(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const { esc, money, clone } = BlessERP.utils;
  const journalService = BlessERP.services.journal;
  const chartService = BlessERP.services.chartOfAccounts;
  const accountingReadService = () => BlessERP.services.accountingReadV2;

  const uiState = {
    journal: {
      draftFilters: {
        search: "", dateFrom: "", dateTo: "", status: "", originModule: "",
        entryNumber: "", reference: "", pageSize: 25
      },
      draft: null,
      mode: "view",
      message: "",
      errors: [],
      starting: false
    },
    ledger: {
      draftFilters: {
        accountRecordId: "", dateFrom: "", dateTo: "", status: "", search: "", pageSize: 25
      },
      message: "",
      errors: [],
      starting: false
    }
  };

  function routeTabs(route) {
    return `
      <div class="subnav-tabs">
        ${BlessERP.navigation.groupMap[route.groupId].routes.map(item => `
          <button class="subnav-tab ${item.id === route.id ? "active" : ""}" data-route-link="${esc(item.id)}">${esc(item.label)}</button>
        `).join("")}
      </div>
    `;
  }

  function statusBadge(status) {
    const normalized = String(status || "").toLowerCase();
    const css = normalized.includes("borrador")
      ? "pending"
      : normalized.includes("contabilizado")
        ? "authorized"
        : normalized.includes("revers")
          ? "partial"
          : "cancelled";
    return `<span class="status-badge ${css}">${esc(status)}</span>`;
  }

  function startReadService(routeId) {
    const section = routeId === "accounting-ledger" ? uiState.ledger : uiState.journal;
    accountingReadService()?.setActiveRoute?.(routeId);
    if (section.starting) return;
    section.starting = true;
    Promise.resolve(accountingReadService()?.start?.(() => {
      if (BlessERP.state?.currentRoute?.()?.id === routeId) BlessERP.layout.renderPage();
    })).catch(error => {
      section.errors = [error.message || "Backend de lectura contable no disponible."];
    }).finally(() => { section.starting = false; });
  }

  function readSnapshot() {
    return accountingReadService()?.snapshot?.() || {
      error: "Backend de lectura contable no disponible.",
      journal: { loaded: false, loading: false, items: [], total: 0, summary: {}, page: 1, pageSize: 25 },
      ledger: { loaded: false, loading: false, items: [], total: 0, summary: {}, page: 1, pageSize: 25, account: null }
    };
  }

  function validDateRange(filters = {}) {
    return !filters.dateFrom || !filters.dateTo || filters.dateFrom <= filters.dateTo;
  }

  function simplePager(scope, state) {
    const pages = Math.max(1, Math.ceil(Number(state.total || 0) / Number(state.pageSize || 25)));
    if (!state.loaded || pages <= 1) return "";
    return `<div class="table-pager">
      <button class="secondary-button" type="button" data-${scope}-page="${Math.max(1, state.page - 1)}" ${state.page <= 1 ? "disabled" : ""}>Anterior</button>
      <span>Pagina ${esc(String(state.page))} de ${esc(String(pages))}</span>
      <button class="secondary-button" type="button" data-${scope}-page="${Math.min(pages, state.page + 1)}" ${state.page >= pages ? "disabled" : ""}>Siguiente</button>
    </div>`;
  }

  function ensureJournalDraft(entry = null, mode = "new") {
    uiState.journal.draft = entry ? clone(entry) : journalService.emptyEntry();
    uiState.journal.mode = mode;
    uiState.journal.errors = [];
    uiState.journal.message = "";
  }

  function clearJournalDraft() {
    uiState.journal.draft = null;
    uiState.journal.mode = "view";
    uiState.journal.errors = [];
  }

  function currentJournalTotals() {
    const lines = uiState.journal.draft?.lines || [];
    const totals = journalService.linesTotal(lines);
    return {
      debit: totals.debit,
      credit: totals.credit,
      difference: journalService.difference(lines)
    };
  }

  function renderJournalEditor() {
    const entry = uiState.journal.draft;
    if (!entry) return "";
    const readOnly = entry.status !== "BORRADOR" || uiState.journal.mode === "view";
    const accounts = chartService.movementOptions();
    const totals = currentJournalTotals();
    return `
      <article class="panel-card editor-card">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">ASIENTO</p>
            <h3>${entry.id ? `${readOnly ? "Ver" : "Editar"} asiento ${esc(entry.entryNumber)}` : "Nuevo asiento manual"}</h3>
          </div>
          <div class="editor-actions">
            <button class="secondary-button" type="button" data-journal-close>Volver</button>
            ${!readOnly ? `<button class="secondary-button" type="button" data-journal-save>Guardar borrador</button><button class="secondary-button" type="button" data-journal-post>Contabilizar</button>` : ""}
          </div>
        </div>
        ${uiState.journal.errors.length ? `<section class="inline-feedback danger">${uiState.journal.errors.map(item => `<div>${esc(item)}</div>`).join("")}</section>` : ""}
        <form id="journal-entry-form" class="journal-entry-grid">
          <label class="compact-field"><span>Numero de asiento</span><input name="entryNumber" value="${esc(entry.entryNumber)}" readonly></label>
          <label class="compact-field"><span>Fecha contable</span><input name="accountingDate" type="date" value="${esc(entry.accountingDate)}" ${readOnly ? "disabled" : ""}></label>
          <label class="compact-field"><span>Periodo contable</span><input name="accountingPeriod" value="${esc(entry.accountingPeriod)}" readonly></label>
          <label class="compact-field">
            <span>Modulo origen</span>
            <select name="originModule" ${readOnly ? "disabled" : ""}>
              ${journalService.originModules.map(option => `<option value="${esc(option)}" ${entry.originModule === option ? "selected" : ""}>${esc(option)}</option>`).join("")}
            </select>
          </label>
          <label class="compact-field full"><span>Concepto / glosa</span><input name="concept" value="${esc(entry.concept)}" ${readOnly ? "disabled" : ""}></label>
          <label class="compact-field"><span>Documento origen</span><input name="sourceDocument" value="${esc(entry.sourceDocument || "")}" ${readOnly ? "disabled" : ""}></label>
          <label class="compact-field"><span>Referencia externa</span><input name="externalReference" value="${esc(entry.externalReference || "")}" ${readOnly ? "disabled" : ""}></label>
          <label class="compact-field"><span>Estado</span><input value="${esc(entry.status)}" readonly></label>
          <label class="compact-field"><span>Usuario creador</span><input value="${esc(entry.createdBy || "")}" readonly></label>
          <label class="compact-field full"><span>Observacion</span><textarea name="observation" rows="2" ${readOnly ? "disabled" : ""}>${esc(entry.observation || "")}</textarea></label>
        </form>
        <div class="journal-lines-head">
          <div>
            <p class="section-kicker">DETALLE</p>
            <h3>Lineas del asiento</h3>
          </div>
          ${!readOnly ? `<button class="secondary-button" type="button" data-journal-add-line>Agregar linea</button>` : ""}
        </div>
        <div class="journal-lines-wrap">
          <table class="compact-table journal-lines-table">
            <thead>
              <tr>
                <th>Cuenta contable</th>
                <th>Debe</th>
                <th>Haber</th>
                <th>Centro de costo</th>
                <th>Auxiliar</th>
                <th>Descripcion</th>
                <th>Referencia</th>
                ${!readOnly ? `<th></th>` : ""}
              </tr>
            </thead>
            <tbody>
              ${(entry.lines || []).map(line => `
                <tr data-line-id="${esc(line.id)}">
                  <td>
                    <select name="accountCode" ${readOnly ? "disabled" : ""}>
                      <option value="">Seleccionar cuenta</option>
                      ${accounts.map(account => `<option value="${esc(account.code)}" ${line.accountCode === account.code ? "selected" : ""}>${esc(account.code)} - ${esc(account.name)}</option>`).join("")}
                    </select>
                  </td>
                  <td><input name="debit" type="number" step="0.01" min="0" value="${esc(String(line.debit || 0))}" ${readOnly ? "disabled" : ""}></td>
                  <td><input name="credit" type="number" step="0.01" min="0" value="${esc(String(line.credit || 0))}" ${readOnly ? "disabled" : ""}></td>
                  <td><input name="costCenter" value="${esc(line.costCenter || "")}" ${readOnly ? "disabled" : ""}></td>
                  <td><input name="auxiliary" value="${esc(line.auxiliary || "")}" ${readOnly ? "disabled" : ""}></td>
                  <td><input name="lineDescription" value="${esc(line.lineDescription || "")}" ${readOnly ? "disabled" : ""}></td>
                  <td><input name="documentReference" value="${esc(line.documentReference || "")}" ${readOnly ? "disabled" : ""}></td>
                  ${!readOnly ? `<td><button class="row-action-button" type="button" data-journal-remove-line="${esc(line.id)}">Quitar</button></td>` : ""}
                </tr>
              `).join("")}
            </tbody>
            <tfoot>
              <tr>
                <td><strong>Totales</strong></td>
                <td><strong id="journal-total-debit">${money(totals.debit)}</strong></td>
                <td><strong id="journal-total-credit">${money(totals.credit)}</strong></td>
                <td colspan="${readOnly ? "4" : "5"}">
                  <div class="journal-difference ${totals.difference === 0 ? "balanced" : "unbalanced"}">
                    Diferencia: <strong id="journal-total-difference">${money(Math.abs(totals.difference))}</strong>
                  </div>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </article>
    `;
  }

  function journalSummaryCards(summary = {}) {
    return `
      <section class="summary-grid summary-grid-accounting">
        <article class="summary-card"><span>Asientos consultados</span><strong>${esc(String(summary.totalEntries || 0))}</strong><small>Universo filtrado</small></article>
        <article class="summary-card"><span>Borradores</span><strong>${esc(String(summary.drafts || 0))}</strong><small>Pendientes de contabilizar</small></article>
        <article class="summary-card"><span>Contabilizados</span><strong>${esc(String(summary.posted || 0))}</strong><small>Con efecto contable</small></article>
        <article class="summary-card"><span>Asientos descuadrados</span><strong>${esc(String(summary.outOfBalance || 0))}</strong><small>Calculado server-side</small></article>
        <article class="summary-card"><span>Total debe</span><strong>${money(summary.totalDebit || 0)}</strong><small>Universo filtrado</small></article>
        <article class="summary-card"><span>Total haber</span><strong>${money(summary.totalCredit || 0)}</strong><small>Diferencia ${money(Math.abs(Number(summary.difference || 0)))}</small></article>
      </section>
    `;
  }

  function renderJournal(container, route) {
    startReadService("accounting-journal");
    const readState = readSnapshot();
    const journalState = readState.journal;
    const filters = uiState.journal.draftFilters;
    container.innerHTML = `
      <section class="page-header">
        <div>
          <p class="section-kicker">${esc(route.groupLabel.toUpperCase())}</p>
          <h1>${esc(route.title)}</h1>
          <p>${esc(route.description)}</p>
        </div>
        <div class="page-header-side">
          <span class="status-badge authorized">Base contable activa</span>
        </div>
      </section>
      ${routeTabs(route)}
      ${uiState.journal.message ? `<section class="inline-feedback success">${esc(uiState.journal.message)}</section>` : ""}
      ${(uiState.journal.errors || []).length || readState.error ? `<section class="inline-feedback danger">${esc((uiState.journal.errors || [])[0] || readState.error)}</section>` : ""}
      ${journalState.loaded ? journalSummaryCards(journalState.summary) : ""}
      <section class="panel-card compact-toolbar-card">
        <form id="journal-search-form" class="compact-toolbar compact-toolbar-journal">
          <label class="compact-inline-field">
            <span>Buscar</span>
            <input id="journal-search" placeholder="Numero, concepto, referencia o modulo" value="${esc(filters.search)}">
          </label>
          <label class="compact-inline-field">
            <span>Fecha desde</span>
            <input id="journal-date-from" type="date" value="${esc(filters.dateFrom)}">
          </label>
          <label class="compact-inline-field">
            <span>Fecha hasta</span>
            <input id="journal-date-to" type="date" value="${esc(filters.dateTo)}">
          </label>
          <label class="compact-inline-field">
            <span>Estado</span>
            <select id="journal-status">
              <option value="">Todos</option>
              ${journalService.statuses.map(status => `<option value="${esc(status)}" ${filters.status === status ? "selected" : ""}>${esc(status)}</option>`).join("")}
            </select>
          </label>
          <label class="compact-inline-field">
            <span>Modulo origen</span>
            <select id="journal-origin">
              <option value="">Todos</option>
              ${journalService.originModules.map(origin => `<option value="${esc(origin)}" ${filters.originModule === origin ? "selected" : ""}>${esc(origin)}</option>`).join("")}
            </select>
          </label>
          <label class="compact-inline-field"><span>Numero asiento</span><input id="journal-entry-number" value="${esc(filters.entryNumber)}"></label>
          <label class="compact-inline-field"><span>Documento / referencia</span><input id="journal-reference" value="${esc(filters.reference)}"></label>
          <label class="compact-inline-field"><span>Filas</span><select id="journal-page-size"><option value="25" ${filters.pageSize === 25 ? "selected" : ""}>25</option><option value="50" ${filters.pageSize === 50 ? "selected" : ""}>50</option></select></label>
          <div class="compact-toolbar-actions">
            <button class="primary-button" type="submit" ${journalState.loading ? "disabled" : ""}>${journalState.loading ? "Consultando..." : "Consultar"}</button>
            <button class="secondary-button" type="button" data-journal-new>Nuevo asiento</button>
          </div>
        </form>
      </section>
      ${renderJournalEditor()}
      <article class="panel-card">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">ASIENTOS</p>
            <h3>Libro Diario</h3>
          </div>
          <span class="status-badge partial">${journalState.loaded ? `${esc(String(journalState.total))} registros` : "Sin consultar"}</span>
        </div>
        <div class="compact-table-wrap">
          <table class="compact-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Numero</th>
                <th>Concepto</th>
                <th>Modulo</th>
                <th>Estado</th>
                <th>Debe</th>
                <th>Haber</th>
                <th>Diferencia</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              ${journalState.loaded ? journalState.items.map(entry => `
                  <tr>
                    <td>${esc(entry.accountingDate)}</td>
                    <td><strong>${esc(entry.entryNumber)}</strong><small>${esc(entry.accountingPeriod)}</small></td>
                    <td><strong>${esc(entry.concept)}</strong><small>${esc(entry.sourceDocument || entry.externalReference || entry.observation || "")}</small></td>
                    <td>${esc(entry.originModule)}</td>
                    <td>${statusBadge(entry.status)}</td>
                    <td>${money(entry.totalDebit)}</td>
                    <td>${money(entry.totalCredit)}</td>
                    <td><span class="difference-pill ${entry.difference === 0 ? "balanced" : "unbalanced"}">${money(Math.abs(entry.difference))}</span><small>${esc(String(entry.lineCount))} lineas</small></td>
                    <td>
                      <div class="row-actions">
                        <button class="row-action-button" type="button" data-journal-view="${esc(entry.entryKey)}" data-source-kind="${esc(entry.sourceKind)}">Ver</button>
                        ${entry.sourceKind === "LEGACY" && entry.status === "BORRADOR" ? `<button class="row-action-button" type="button" data-journal-edit="${esc(entry.entryKey)}" data-source-kind="${esc(entry.sourceKind)}">Editar</button><button class="row-action-button" type="button" data-journal-post-row="${esc(entry.entryKey)}">Contabilizar</button><button class="row-action-button" type="button" data-journal-cancel="${esc(entry.entryKey)}">Anular</button><button class="row-action-button" type="button" data-journal-delete="${esc(entry.entryKey)}">Eliminar</button>` : ""}
                        ${entry.sourceKind === "FINANCIAL_V2" && entry.status === "CONTABILIZADO" ? `<button class="row-action-button" type="button" data-journal-reverse="${esc(entry.entryKey)}">Reversar</button>` : ""}
                      </div>
                    </td>
                  </tr>
                `).join("") || `<tr><td colspan="9"><div class="empty-inline">No hay asientos para estos filtros.</div></td></tr>` : `<tr><td colspan="9"><div class="empty-inline">Selecciona los filtros y pulsa Consultar.</div></td></tr>`}
            </tbody>
          </table>
        </div>
        ${simplePager("journal", journalState)}
      </article>
    `;
    bindJournal();
  }

  function collectJournalForm() {
    const entry = clone(uiState.journal.draft || journalService.emptyEntry());
    const form = document.querySelector("#journal-entry-form");
    if (form) {
      entry.accountingDate = form.elements.accountingDate?.value || entry.accountingDate;
      entry.accountingPeriod = journalService.accountingPeriodForDate?.(
        entry.accountingDate,
        form.elements.accountingPeriod?.value || entry.accountingPeriod
      ) || String(entry.accountingDate || "").slice(0, 7) || entry.accountingPeriod;
      entry.concept = form.elements.concept?.value || entry.concept;
      entry.originModule = form.elements.originModule?.value || entry.originModule;
      entry.sourceDocument = form.elements.sourceDocument?.value || "";
      entry.externalReference = form.elements.externalReference?.value || "";
      entry.observation = form.elements.observation?.value || "";
    }
    entry.lines = Array.from(document.querySelectorAll(".journal-lines-table tbody tr[data-line-id]")).map(row => {
      const accountCode = row.querySelector('[name="accountCode"]')?.value || "";
      const account = chartService.findByCode(accountCode);
      return {
        id: row.dataset.lineId,
        accountCode,
        accountName: account?.name || "",
        debit: Number(row.querySelector('[name="debit"]')?.value || 0),
        credit: Number(row.querySelector('[name="credit"]')?.value || 0),
        costCenter: row.querySelector('[name="costCenter"]')?.value || "",
        auxiliary: row.querySelector('[name="auxiliary"]')?.value || "",
        lineDescription: row.querySelector('[name="lineDescription"]')?.value || "",
        documentReference: row.querySelector('[name="documentReference"]')?.value || ""
      };
    });
    return entry;
  }

  function updateJournalTotalsView() {
    uiState.journal.draft = collectJournalForm();
    const totals = currentJournalTotals();
    document.querySelector("#journal-total-debit")?.replaceChildren(document.createTextNode(money(totals.debit)));
    document.querySelector("#journal-total-credit")?.replaceChildren(document.createTextNode(money(totals.credit)));
    document.querySelector("#journal-total-difference")?.replaceChildren(document.createTextNode(money(Math.abs(totals.difference))));
    const differenceNode = document.querySelector(".journal-difference");
    if (differenceNode) {
      differenceNode.classList.toggle("balanced", totals.difference === 0);
      differenceNode.classList.toggle("unbalanced", totals.difference !== 0);
    }
  }

  function bindJournal() {
    const syncJournalDraftFilters = () => {
      Object.assign(uiState.journal.draftFilters, {
        search: document.querySelector("#journal-search")?.value || "",
        dateFrom: document.querySelector("#journal-date-from")?.value || "",
        dateTo: document.querySelector("#journal-date-to")?.value || "",
        status: document.querySelector("#journal-status")?.value || "",
        originModule: document.querySelector("#journal-origin")?.value || "",
        entryNumber: document.querySelector("#journal-entry-number")?.value || "",
        reference: document.querySelector("#journal-reference")?.value || "",
        pageSize: Number(document.querySelector("#journal-page-size")?.value || 25)
      });
    };
    ["#journal-search", "#journal-date-from", "#journal-date-to", "#journal-status", "#journal-origin", "#journal-entry-number", "#journal-reference", "#journal-page-size"]
      .forEach(selector => document.querySelector(selector)?.addEventListener("change", syncJournalDraftFilters));
    document.querySelector("#journal-search-form")?.addEventListener("submit", async event => {
      event.preventDefault();
      syncJournalDraftFilters();
      uiState.journal.errors = [];
      if (!validDateRange(uiState.journal.draftFilters)) {
        uiState.journal.errors = ["La fecha Desde no puede ser posterior a Hasta."];
        BlessERP.layout.renderPage();
        return;
      }
      try {
        await accountingReadService().queryJournal(uiState.journal.draftFilters, { page: 1, pageSize: uiState.journal.draftFilters.pageSize });
      } catch (error) {
        uiState.journal.errors = [error.message];
      }
      BlessERP.layout.renderPage();
    });
    document.querySelectorAll("[data-journal-page]").forEach(button => button.addEventListener("click", async () => {
      const current = readSnapshot().journal;
      try {
        await accountingReadService().queryJournal(current.appliedFilters, { page: Number(button.dataset.journalPage), pageSize: current.pageSize });
      } catch (error) { uiState.journal.errors = [error.message]; }
      BlessERP.layout.renderPage();
    }));
    document.querySelector("[data-journal-new]")?.addEventListener("click", () => { ensureJournalDraft(); BlessERP.layout.renderPage(); });
    document.querySelector("[data-journal-close]")?.addEventListener("click", () => { clearJournalDraft(); BlessERP.layout.renderPage(); });
    document.querySelector("[data-journal-add-line]")?.addEventListener("click", () => {
      uiState.journal.draft = collectJournalForm();
      uiState.journal.draft.lines.push(journalService.emptyLine());
      BlessERP.layout.renderPage();
    });
    document.querySelectorAll("[data-journal-remove-line]").forEach(button => button.addEventListener("click", () => {
      uiState.journal.draft = collectJournalForm();
      uiState.journal.draft.lines = uiState.journal.draft.lines.filter(line => line.id !== button.dataset.journalRemoveLine);
      if (uiState.journal.draft.lines.length < 2) uiState.journal.draft.lines.push(journalService.emptyLine());
      BlessERP.layout.renderPage();
    }));
    document.querySelector("#journal-entry-form")?.addEventListener("input", updateJournalTotalsView);
    document.querySelector(".journal-lines-table tbody")?.addEventListener("input", updateJournalTotalsView);
    document.querySelector('#journal-entry-form [name="accountingDate"]')?.addEventListener("change", event => {
      const periodInput = document.querySelector('#journal-entry-form [name="accountingPeriod"]');
      if (!periodInput) return;
      periodInput.value = journalService.accountingPeriodForDate?.(event.target.value, periodInput.value)
        || String(event.target.value || "").slice(0, 7)
        || periodInput.value;
    });
    document.querySelector("[data-journal-save]")?.addEventListener("click", async event => {
      event.currentTarget.disabled = true;
      const result = await journalService.saveDraftConfirmed(collectJournalForm());
      if (result.contextChanged) return;
      if (result.entry) uiState.journal.draft = clone(result.entry);
      uiState.journal.errors = result.errors || [];
      uiState.journal.message = "";
      if (!result.ok || !result.confirmed) {
        BlessERP.layout.renderPage();
        return;
      }
      uiState.journal.draft = clone(result.entry);
      uiState.journal.message = "Borrador guardado correctamente.";
      void accountingReadService()?.refreshActive?.();
      BlessERP.layout.renderPage();
    });
    document.querySelector("[data-journal-post]")?.addEventListener("click", async event => {
      event.currentTarget.disabled = true;
      const saved = await journalService.saveDraftConfirmed(collectJournalForm());
      if (saved.contextChanged) return;
      if (!saved.ok) {
        uiState.journal.errors = saved.errors || [];
        BlessERP.layout.renderPage();
        return;
      }
      const result = await journalService.postEntryV2(saved.entry);
      uiState.journal.errors = result.errors || [];
      uiState.journal.message = "";
      if (!result.ok) {
        uiState.journal.draft = clone(saved.entry);
        BlessERP.layout.renderPage();
        return;
      }
      clearJournalDraft();
      uiState.journal.message = `Asiento ${result.entry?.entryNumber || ""} contabilizado y confirmado en Supabase.`;
      await accountingReadService()?.refreshActive?.();
      BlessERP.layout.renderPage();
    });
    document.querySelectorAll("[data-journal-view]").forEach(button => button.addEventListener("click", async () => {
      try {
        const entry = await accountingReadService().journalDetail(button.dataset.journalView, button.dataset.sourceKind);
        ensureJournalDraft(entry, "view");
      } catch (error) { uiState.journal.errors = [error.message]; }
      BlessERP.layout.renderPage();
    }));
    document.querySelectorAll("[data-journal-edit]").forEach(button => button.addEventListener("click", async () => {
      try {
        const entry = await accountingReadService().journalDetail(button.dataset.journalEdit, button.dataset.sourceKind);
        ensureJournalDraft(entry, "edit");
      } catch (error) { uiState.journal.errors = [error.message]; }
      BlessERP.layout.renderPage();
    }));
    document.querySelectorAll("[data-journal-post-row]").forEach(button => button.addEventListener("click", async () => {
      button.disabled = true;
      const result = await journalService.postEntryV2(button.dataset.journalPostRow);
      uiState.journal.errors = result.errors || [];
      uiState.journal.message = result.ok ? `Asiento ${result.entry?.entryNumber || ""} confirmado en Supabase.` : "";
      if (result.ok) await accountingReadService()?.refreshActive?.();
      BlessERP.layout.renderPage();
    }));
    document.querySelectorAll("[data-journal-cancel]").forEach(button => button.addEventListener("click", async () => {
      const result = await journalService.cancelDraft(button.dataset.journalCancel);
      uiState.journal.message = result.ok ? "Borrador anulado." : (result.message || "");
      uiState.journal.errors = [];
      if (result.ok) void accountingReadService()?.refreshActive?.();
      BlessERP.layout.renderPage();
    }));
    document.querySelectorAll("[data-journal-delete]").forEach(button => button.addEventListener("click", async () => {
      const result = await journalService.deleteDraft(button.dataset.journalDelete);
      uiState.journal.message = result.ok ? "Borrador eliminado." : (result.message || "");
      uiState.journal.errors = [];
      if (result.ok) void accountingReadService()?.refreshActive?.();
      BlessERP.layout.renderPage();
    }));
    document.querySelectorAll("[data-journal-reverse]").forEach(button => button.addEventListener("click", async () => {
      const reason = window.prompt("Motivo obligatorio de la reversión contable:", "Corrección contable autorizada");
      if (!reason) return;
      button.disabled = true;
      const result = await journalService.reverseEntryV2(button.dataset.journalReverse, reason);
      uiState.journal.message = result.ok ? `Se generó el reverso ${result.entry.entryNumber}.` : (result.message || "");
      uiState.journal.errors = result.ok ? [] : (result.errors || []);
      if (result.ok) await accountingReadService()?.refreshActive?.();
      BlessERP.layout.renderPage();
    }));
  }

  function renderLedger(container, route) {
    startReadService("accounting-ledger");
    const accountOptions = chartService.movementOptions();
    const readState = readSnapshot();
    const ledgerState = readState.ledger;
    const filters = uiState.ledger.draftFilters;
    const summary = ledgerState.summary || {};

    container.innerHTML = `
      <section class="page-header">
        <div>
          <p class="section-kicker">${esc(route.groupLabel.toUpperCase())}</p>
          <h1>${esc(route.title)}</h1>
          <p>${esc(route.description)}</p>
        </div>
        <div class="page-header-side">
          <span class="status-badge authorized">Consulta desde Libro Diario</span>
        </div>
      </section>
      ${routeTabs(route)}
      ${uiState.ledger.message ? `<section class="inline-feedback success">${esc(uiState.ledger.message)}</section>` : ""}
      ${(uiState.ledger.errors || []).length || readState.error ? `<section class="inline-feedback danger">${esc((uiState.ledger.errors || [])[0] || readState.error)}</section>` : ""}
      <section class="panel-card compact-toolbar-card">
        <form id="ledger-search-form" class="compact-toolbar compact-toolbar-ledger">
          <label class="compact-inline-field">
            <span>Cuenta contable</span>
            <select id="ledger-account">
              <option value="">Seleccionar cuenta</option>
              ${accountOptions.map(account => `<option value="${esc(account.id)}" ${filters.accountRecordId === account.id ? "selected" : ""}>${esc(account.code)} - ${esc(account.name)}</option>`).join("")}
            </select>
          </label>
          <label class="compact-inline-field"><span>Fecha desde</span><input id="ledger-date-from" type="date" value="${esc(filters.dateFrom)}"></label>
          <label class="compact-inline-field"><span>Fecha hasta</span><input id="ledger-date-to" type="date" value="${esc(filters.dateTo)}"></label>
          <label class="compact-inline-field">
            <span>Estado</span>
            <select id="ledger-status">
              <option value="">Todos</option>
              <option value="CONTABILIZADO" ${filters.status === "CONTABILIZADO" ? "selected" : ""}>CONTABILIZADO</option>
              <option value="REVERSADO" ${filters.status === "REVERSADO" ? "selected" : ""}>REVERSADO</option>
            </select>
          </label>
          <label class="compact-inline-field"><span>Buscar / referencia</span><input id="ledger-search" value="${esc(filters.search)}"></label>
          <label class="compact-inline-field"><span>Filas</span><select id="ledger-page-size"><option value="25" ${filters.pageSize === 25 ? "selected" : ""}>25</option><option value="50" ${filters.pageSize === 50 ? "selected" : ""}>50</option></select></label>
          <div class="compact-toolbar-actions"><button class="primary-button" type="submit" ${ledgerState.loading ? "disabled" : ""}>${ledgerState.loading ? "Consultando..." : "Consultar"}</button></div>
        </form>
      </section>
      ${ledgerState.loaded ? `
        <section class="summary-grid summary-grid-ledger">
          <article class="summary-card"><span>Saldo inicial</span><strong>${money(summary.initialBalance || 0)}</strong><small>${esc(ledgerState.account?.name || "")}</small></article>
          <article class="summary-card"><span>Total debe</span><strong>${money(summary.totalDebit || 0)}</strong><small>Movimientos del rango</small></article>
          <article class="summary-card"><span>Total haber</span><strong>${money(summary.totalCredit || 0)}</strong><small>Movimientos del rango</small></article>
          <article class="summary-card"><span>Saldo final</span><strong>${money(summary.finalBalance || 0)}</strong><small>${esc(String(summary.movementCount || 0))} movimientos · naturaleza ${esc(ledgerState.account?.nature || "")}</small></article>
        </section>
        <article class="panel-card">
          <div class="panel-card-head">
            <div><p class="section-kicker">DETALLE</p><h3>Mayor por cuenta</h3></div>
            ${statusBadge(ledgerState.account?.nature || "")}
          </div>
          <div class="compact-table-wrap">
            <table class="compact-table">
              <thead><tr><th>Fecha</th><th>Numero</th><th>Concepto</th><th>Documento origen</th><th>Debe</th><th>Haber</th><th>Saldo</th><th>Modulo origen</th><th>Estado</th></tr></thead>
              <tbody>
                <tr><td colspan="6"><strong>Saldo inicial del rango</strong></td><td><strong>${money(summary.initialBalance || 0)}</strong></td><td colspan="2"></td></tr>
                ${ledgerState.items.map(row => `
                  <tr>
                    <td>${esc(row.date)}</td>
                    <td>${esc(row.entryNumber)}</td>
                    <td>${esc(row.concept)}</td>
                    <td>${esc(row.sourceDocument || "-")}</td>
                    <td>${money(row.debit)}</td>
                    <td>${money(row.credit)}</td>
                    <td>${money(row.balance)}</td>
                    <td>${esc(row.originModule)}</td>
                    <td>${statusBadge(row.status)}</td>
                  </tr>
                `).join("") || `<tr><td colspan="9"><div class="empty-inline">No hay movimientos contabilizados para esta cuenta.</div></td></tr>`}
                <tr><td colspan="4"><strong>Totales del rango</strong></td><td><strong>${money(summary.totalDebit || 0)}</strong></td><td><strong>${money(summary.totalCredit || 0)}</strong></td><td><strong>${money(summary.finalBalance || 0)}</strong></td><td colspan="2"></td></tr>
              </tbody>
            </table>
          </div>
          ${simplePager("ledger", ledgerState)}
        </article>
      ` : `
        <article class="panel-card">
          <div class="panel-card-head">
            <div><p class="section-kicker">MAYOR</p><h3>Consulta por cuenta</h3></div>
            <span class="status-badge partial">Sin consultar</span>
          </div>
          <div class="empty-inline">Selecciona una cuenta, define el rango y pulsa Consultar.</div>
        </article>
      `}
    `;
    bindLedger();
  }

  function bindLedger() {
    const syncLedgerDraftFilters = () => {
      Object.assign(uiState.ledger.draftFilters, {
        accountRecordId: document.querySelector("#ledger-account")?.value || "",
        dateFrom: document.querySelector("#ledger-date-from")?.value || "",
        dateTo: document.querySelector("#ledger-date-to")?.value || "",
        status: document.querySelector("#ledger-status")?.value || "",
        search: document.querySelector("#ledger-search")?.value || "",
        pageSize: Number(document.querySelector("#ledger-page-size")?.value || 25)
      });
    };
    ["#ledger-account", "#ledger-date-from", "#ledger-date-to", "#ledger-status", "#ledger-search", "#ledger-page-size"]
      .forEach(selector => document.querySelector(selector)?.addEventListener("change", syncLedgerDraftFilters));
    document.querySelector("#ledger-search-form")?.addEventListener("submit", async event => {
      event.preventDefault();
      syncLedgerDraftFilters();
      uiState.ledger.errors = [];
      if (!uiState.ledger.draftFilters.accountRecordId) uiState.ledger.errors.push("Selecciona una cuenta contable antes de consultar.");
      if (!validDateRange(uiState.ledger.draftFilters)) uiState.ledger.errors.push("La fecha Desde no puede ser posterior a Hasta.");
      if (uiState.ledger.errors.length) { BlessERP.layout.renderPage(); return; }
      try {
        await accountingReadService().queryLedger(uiState.ledger.draftFilters, { page: 1, pageSize: uiState.ledger.draftFilters.pageSize });
      } catch (error) { uiState.ledger.errors = [error.message]; }
      BlessERP.layout.renderPage();
    });
    document.querySelectorAll("[data-ledger-page]").forEach(button => button.addEventListener("click", async () => {
      const current = readSnapshot().ledger;
      try {
        await accountingReadService().queryLedger(current.appliedFilters, { page: Number(button.dataset.ledgerPage), pageSize: current.pageSize });
      } catch (error) { uiState.ledger.errors = [error.message]; }
      BlessERP.layout.renderPage();
    }));
  }

  BlessERP.modules = BlessERP.modules || {};
  BlessERP.modules.part2Accounting = {
    renderJournal,
    renderLedger
  };
})();
