(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const { esc, money, clone } = BlessERP.utils;
  const journalService = BlessERP.services.journal;
  const chartService = BlessERP.services.chartOfAccounts;
  const companyService = BlessERP.services.companySettings;

  const uiState = {
    journal: {
      search: "",
      dateFrom: "",
      dateTo: "",
      status: "",
      originModule: "",
      draft: null,
      mode: "view",
      message: "",
      errors: []
    },
    ledger: {
      accountCode: "",
      dateFrom: "",
      dateTo: "",
      status: "",
      costCenter: "",
      auxiliary: "",
      message: ""
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

  function filteredJournalEntries() {
    return journalService.sortEntries(journalService.all()).filter(entry => {
      const haystack = [
        entry.entryNumber,
        entry.accountingDate,
        entry.concept,
        entry.originModule,
        entry.sourceDocument,
        entry.externalReference,
        ...(entry.lines || []).map(line => `${line.accountCode} ${line.accountName} ${line.lineDescription}`)
      ].join(" ").toLowerCase();
      return (!uiState.journal.search || haystack.includes(uiState.journal.search.toLowerCase()))
        && (!uiState.journal.dateFrom || entry.accountingDate >= uiState.journal.dateFrom)
        && (!uiState.journal.dateTo || entry.accountingDate <= uiState.journal.dateTo)
        && (!uiState.journal.status || entry.status === uiState.journal.status)
        && (!uiState.journal.originModule || entry.originModule === uiState.journal.originModule);
    });
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
          <label class="compact-field"><span>Periodo contable</span><input name="accountingPeriod" value="${esc(entry.accountingPeriod)}" ${readOnly ? "disabled" : ""}></label>
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

  function journalSummaryCards() {
    const summary = journalService.journalSummaries(companyService.settings().activePeriod);
    return `
      <section class="summary-grid summary-grid-accounting">
        <article class="summary-card"><span>Asientos en borrador</span><strong>${esc(String(summary.drafts))}</strong><small>Pendientes de revision o contabilizacion</small></article>
        <article class="summary-card"><span>Asientos contabilizados</span><strong>${esc(String(summary.contabilized))}</strong><small>Del periodo activo</small></article>
        <article class="summary-card"><span>Asientos descuadrados</span><strong>${esc(String(summary.outOfBalance))}</strong><small>Borradores con diferencia</small></article>
        <article class="summary-card"><span>Ultimo asiento</span><strong>${esc(summary.latest?.entryNumber || "-")}</strong><small>${esc(summary.latest?.concept || "Sin registros")}</small></article>
        <article class="summary-card"><span>Total debe del periodo</span><strong>${money(summary.totalDebit)}</strong><small>Asientos con efecto contable</small></article>
        <article class="summary-card"><span>Total haber del periodo</span><strong>${money(summary.totalCredit)}</strong><small>Asientos con efecto contable</small></article>
      </section>
    `;
  }

  function renderJournal(container, route) {
    const rows = filteredJournalEntries();
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
      ${journalSummaryCards()}
      <section class="panel-card compact-toolbar-card">
        <div class="compact-toolbar compact-toolbar-journal">
          <label class="compact-inline-field">
            <span>Buscar</span>
            <input id="journal-search" placeholder="Numero, concepto, cuenta o modulo" value="${esc(uiState.journal.search)}">
          </label>
          <label class="compact-inline-field">
            <span>Fecha desde</span>
            <input id="journal-date-from" type="date" value="${esc(uiState.journal.dateFrom)}">
          </label>
          <label class="compact-inline-field">
            <span>Fecha hasta</span>
            <input id="journal-date-to" type="date" value="${esc(uiState.journal.dateTo)}">
          </label>
          <label class="compact-inline-field">
            <span>Estado</span>
            <select id="journal-status">
              <option value="">Todos</option>
              ${journalService.statuses.map(status => `<option value="${esc(status)}" ${uiState.journal.status === status ? "selected" : ""}>${esc(status)}</option>`).join("")}
            </select>
          </label>
          <label class="compact-inline-field">
            <span>Modulo origen</span>
            <select id="journal-origin">
              <option value="">Todos</option>
              ${journalService.originModules.map(origin => `<option value="${esc(origin)}" ${uiState.journal.originModule === origin ? "selected" : ""}>${esc(origin)}</option>`).join("")}
            </select>
          </label>
          <div class="compact-toolbar-actions">
            <button class="secondary-button" type="button" data-journal-new>Nuevo asiento</button>
            <button class="secondary-button" type="button" data-journal-export>Exportar</button>
          </div>
        </div>
      </section>
      ${renderJournalEditor()}
      <article class="panel-card">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">ASIENTOS</p>
            <h3>Libro Diario</h3>
          </div>
          <span class="status-badge partial">${esc(String(rows.length))} registros visibles</span>
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
              ${rows.map(entry => {
                const totals = journalService.linesTotal(entry.lines);
                const diff = journalService.difference(entry.lines);
                return `
                  <tr>
                    <td>${esc(entry.accountingDate)}</td>
                    <td><strong>${esc(entry.entryNumber)}</strong><small>${esc(entry.accountingPeriod)}</small></td>
                    <td><strong>${esc(entry.concept)}</strong><small>${esc(entry.sourceDocument || entry.externalReference || entry.observation || "")}</small></td>
                    <td>${esc(entry.originModule)}</td>
                    <td>${statusBadge(entry.status)}</td>
                    <td>${money(totals.debit)}</td>
                    <td>${money(totals.credit)}</td>
                    <td><span class="difference-pill ${diff === 0 ? "balanced" : "unbalanced"}">${money(Math.abs(diff))}</span></td>
                    <td>
                      <div class="row-actions">
                        <button class="row-action-button" type="button" data-journal-view="${esc(entry.id)}">Ver</button>
                        ${entry.status === "BORRADOR" ? `<button class="row-action-button" type="button" data-journal-edit="${esc(entry.id)}">Editar</button><button class="row-action-button" type="button" data-journal-post-row="${esc(entry.id)}">Contabilizar</button><button class="row-action-button" type="button" data-journal-cancel="${esc(entry.id)}">Anular</button><button class="row-action-button" type="button" data-journal-delete="${esc(entry.id)}">Eliminar</button>` : ""}
                        ${entry.status === "CONTABILIZADO" ? `<button class="row-action-button" type="button" data-journal-reverse="${esc(entry.id)}">Reversar</button>` : ""}
                      </div>
                    </td>
                  </tr>
                `;
              }).join("") || `<tr><td colspan="9"><div class="empty-inline">No hay asientos para estos filtros.</div></td></tr>`}
            </tbody>
          </table>
        </div>
      </article>
    `;
    bindJournal();
  }

  function collectJournalForm() {
    const entry = clone(uiState.journal.draft || journalService.emptyEntry());
    const form = document.querySelector("#journal-entry-form");
    if (form) {
      entry.accountingDate = form.elements.accountingDate?.value || entry.accountingDate;
      entry.accountingPeriod = form.elements.accountingPeriod?.value || entry.accountingPeriod;
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
    document.querySelector("#journal-search")?.addEventListener("input", event => { uiState.journal.search = event.target.value; BlessERP.layout.renderPage(); });
    document.querySelector("#journal-date-from")?.addEventListener("change", event => { uiState.journal.dateFrom = event.target.value; BlessERP.layout.renderPage(); });
    document.querySelector("#journal-date-to")?.addEventListener("change", event => { uiState.journal.dateTo = event.target.value; BlessERP.layout.renderPage(); });
    document.querySelector("#journal-status")?.addEventListener("change", event => { uiState.journal.status = event.target.value; BlessERP.layout.renderPage(); });
    document.querySelector("#journal-origin")?.addEventListener("change", event => { uiState.journal.originModule = event.target.value; BlessERP.layout.renderPage(); });
    document.querySelector("[data-journal-new]")?.addEventListener("click", () => { ensureJournalDraft(); BlessERP.layout.renderPage(); });
    document.querySelector("[data-journal-export]")?.addEventListener("click", () => { uiState.journal.message = "La exportacion del Libro Diario quedara en una siguiente fase."; BlessERP.layout.renderPage(); });
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
    document.querySelector("[data-journal-save]")?.addEventListener("click", () => {
      const result = journalService.saveDraft(collectJournalForm());
      uiState.journal.errors = result.errors || [];
      uiState.journal.message = "";
      if (!result.ok) {
        BlessERP.layout.renderPage();
        return;
      }
      uiState.journal.draft = clone(result.entry);
      uiState.journal.message = "Borrador guardado correctamente.";
      BlessERP.layout.renderPage();
    });
    document.querySelector("[data-journal-post]")?.addEventListener("click", () => {
      const saved = journalService.saveDraft(collectJournalForm());
      if (!saved.ok) {
        uiState.journal.errors = saved.errors || [];
        BlessERP.layout.renderPage();
        return;
      }
      const result = journalService.postEntry(saved.entry.id);
      uiState.journal.errors = result.errors || [];
      uiState.journal.message = "";
      if (!result.ok) {
        uiState.journal.draft = clone(saved.entry);
        BlessERP.layout.renderPage();
        return;
      }
      clearJournalDraft();
      uiState.journal.message = "Asiento contabilizado correctamente.";
      BlessERP.layout.renderPage();
    });
    document.querySelectorAll("[data-journal-view]").forEach(button => button.addEventListener("click", () => {
      const entry = journalService.all().find(item => item.id === button.dataset.journalView);
      if (!entry) return;
      ensureJournalDraft(entry, "view");
      BlessERP.layout.renderPage();
    }));
    document.querySelectorAll("[data-journal-edit]").forEach(button => button.addEventListener("click", () => {
      const entry = journalService.all().find(item => item.id === button.dataset.journalEdit);
      if (!entry) return;
      ensureJournalDraft(entry, "edit");
      BlessERP.layout.renderPage();
    }));
    document.querySelectorAll("[data-journal-post-row]").forEach(button => button.addEventListener("click", () => {
      const result = journalService.postEntry(button.dataset.journalPostRow);
      uiState.journal.errors = result.errors || [];
      uiState.journal.message = result.ok ? "Asiento contabilizado correctamente." : "";
      BlessERP.layout.renderPage();
    }));
    document.querySelectorAll("[data-journal-cancel]").forEach(button => button.addEventListener("click", () => {
      const result = journalService.cancelDraft(button.dataset.journalCancel);
      uiState.journal.message = result.ok ? "Borrador anulado." : (result.message || "");
      uiState.journal.errors = [];
      BlessERP.layout.renderPage();
    }));
    document.querySelectorAll("[data-journal-delete]").forEach(button => button.addEventListener("click", () => {
      const result = journalService.deleteDraft(button.dataset.journalDelete);
      uiState.journal.message = result.ok ? "Borrador eliminado." : (result.message || "");
      uiState.journal.errors = [];
      BlessERP.layout.renderPage();
    }));
    document.querySelectorAll("[data-journal-reverse]").forEach(button => button.addEventListener("click", () => {
      const result = journalService.reverseEntry(button.dataset.journalReverse);
      uiState.journal.message = result.ok ? `Se generó el reverso ${result.entry.entryNumber}.` : (result.message || "");
      uiState.journal.errors = [];
      BlessERP.layout.renderPage();
    }));
  }

  function renderLedger(container, route) {
    const accountOptions = chartService.movementOptions();
    const filters = {
      accountCode: uiState.ledger.accountCode,
      dateFrom: uiState.ledger.dateFrom,
      dateTo: uiState.ledger.dateTo,
      status: uiState.ledger.status,
      costCenter: uiState.ledger.costCenter,
      auxiliary: uiState.ledger.auxiliary
    };
    const detailed = uiState.ledger.accountCode ? journalService.ledgerByAccount(uiState.ledger.accountCode, filters) : null;
    const summary = uiState.ledger.accountCode ? [] : journalService.ledgerSummary(filters);

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
      <section class="panel-card compact-toolbar-card">
        <div class="compact-toolbar compact-toolbar-ledger">
          <label class="compact-inline-field">
            <span>Cuenta contable</span>
            <select id="ledger-account">
              <option value="">Vista general agrupada</option>
              ${accountOptions.map(account => `<option value="${esc(account.code)}" ${uiState.ledger.accountCode === account.code ? "selected" : ""}>${esc(account.code)} - ${esc(account.name)}</option>`).join("")}
            </select>
          </label>
          <label class="compact-inline-field"><span>Fecha desde</span><input id="ledger-date-from" type="date" value="${esc(uiState.ledger.dateFrom)}"></label>
          <label class="compact-inline-field"><span>Fecha hasta</span><input id="ledger-date-to" type="date" value="${esc(uiState.ledger.dateTo)}"></label>
          <label class="compact-inline-field">
            <span>Estado</span>
            <select id="ledger-status">
              <option value="">Todos</option>
              <option value="CONTABILIZADO" ${uiState.ledger.status === "CONTABILIZADO" ? "selected" : ""}>CONTABILIZADO</option>
              <option value="REVERSADO" ${uiState.ledger.status === "REVERSADO" ? "selected" : ""}>REVERSADO</option>
            </select>
          </label>
          <label class="compact-inline-field"><span>Centro de costo</span><input id="ledger-cost-center" placeholder="Preparado" value="${esc(uiState.ledger.costCenter)}"></label>
          <label class="compact-inline-field"><span>Auxiliar</span><input id="ledger-auxiliary" placeholder="Preparado" value="${esc(uiState.ledger.auxiliary)}"></label>
        </div>
      </section>
      ${detailed ? `
        <section class="summary-grid summary-grid-ledger">
          <article class="summary-card"><span>Saldo inicial</span><strong>${money(detailed.initialBalance)}</strong><small>${esc(detailed.account.name)}</small></article>
          <article class="summary-card"><span>Total debe</span><strong>${money(detailed.totals.debit)}</strong><small>Movimientos del rango</small></article>
          <article class="summary-card"><span>Total haber</span><strong>${money(detailed.totals.credit)}</strong><small>Movimientos del rango</small></article>
          <article class="summary-card"><span>Saldo final</span><strong>${money(detailed.finalBalance)}</strong><small>Naturaleza ${esc(detailed.account.nature)}</small></article>
        </section>
        <article class="panel-card">
          <div class="panel-card-head">
            <div><p class="section-kicker">DETALLE</p><h3>Mayor por cuenta</h3></div>
            ${statusBadge(detailed.account.nature)}
          </div>
          <div class="compact-table-wrap">
            <table class="compact-table">
              <thead><tr><th>Fecha</th><th>Numero</th><th>Concepto</th><th>Documento origen</th><th>Debe</th><th>Haber</th><th>Saldo</th><th>Modulo origen</th><th>Estado</th></tr></thead>
              <tbody>
                <tr><td colspan="6"><strong>Saldo inicial</strong></td><td><strong>${money(detailed.initialBalance)}</strong></td><td colspan="2"></td></tr>
                ${detailed.rows.map(row => `
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
                <tr><td colspan="4"><strong>Saldo final</strong></td><td><strong>${money(detailed.totals.debit)}</strong></td><td><strong>${money(detailed.totals.credit)}</strong></td><td><strong>${money(detailed.finalBalance)}</strong></td><td colspan="2"></td></tr>
              </tbody>
            </table>
          </div>
        </article>
      ` : `
        <article class="panel-card">
          <div class="panel-card-head">
            <div><p class="section-kicker">RESUMEN</p><h3>Mayor general agrupado por cuenta</h3></div>
            <span class="status-badge partial">${esc(String(summary.length))} cuentas</span>
          </div>
          <div class="compact-table-wrap">
            <table class="compact-table">
              <thead><tr><th>Cuenta</th><th>Nombre</th><th>Naturaleza</th><th>Debe</th><th>Haber</th><th>Saldo</th></tr></thead>
              <tbody>
                ${summary.map(row => `
                  <tr>
                    <td><strong>${esc(row.accountCode)}</strong></td>
                    <td>${esc(row.accountName)}</td>
                    <td>${esc(row.nature)}</td>
                    <td>${money(row.debit)}</td>
                    <td>${money(row.credit)}</td>
                    <td>${money(row.balance)}</td>
                  </tr>
                `).join("") || `<tr><td colspan="6"><div class="empty-inline">No hay movimientos contabilizados para estos filtros.</div></td></tr>`}
              </tbody>
            </table>
          </div>
        </article>
      `}
    `;
    bindLedger();
  }

  function bindLedger() {
    document.querySelector("#ledger-account")?.addEventListener("change", event => { uiState.ledger.accountCode = event.target.value; BlessERP.layout.renderPage(); });
    document.querySelector("#ledger-date-from")?.addEventListener("change", event => { uiState.ledger.dateFrom = event.target.value; BlessERP.layout.renderPage(); });
    document.querySelector("#ledger-date-to")?.addEventListener("change", event => { uiState.ledger.dateTo = event.target.value; BlessERP.layout.renderPage(); });
    document.querySelector("#ledger-status")?.addEventListener("change", event => { uiState.ledger.status = event.target.value; BlessERP.layout.renderPage(); });
    document.querySelector("#ledger-cost-center")?.addEventListener("input", event => { uiState.ledger.costCenter = event.target.value; });
    document.querySelector("#ledger-auxiliary")?.addEventListener("input", event => { uiState.ledger.auxiliary = event.target.value; });
  }

  BlessERP.modules = BlessERP.modules || {};
  BlessERP.modules.part2Accounting = {
    renderJournal,
    renderLedger
  };
})();
