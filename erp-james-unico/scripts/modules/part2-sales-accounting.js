(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const esc = BlessERP.utils.esc;
  const receivables = () => BlessERP.services.receivables;
  const withholdings = () => BlessERP.services.taxWithholdings;
  const uiState = { search: "", status: "", accountingStatus: "", message: "", error: "", importing: false, reconciled: false };
  const inbox = { key: "", companyId: "", request: 0, data: null, error: "", loading: false, offset: 0, posting: false, fiscalState: "", accountingState: "" };

  function loadInbox(force = false) {
    const companyId = BlessERP.getFinancialV2Repository?.()?.activeCompanyUuid?.() || "";
    if (inbox.companyId !== companyId) {
      inbox.companyId = companyId;
      inbox.offset = 0;
      uiState.message = "";
      uiState.error = "";
    }
    const key = JSON.stringify([companyId, uiState.search, inbox.offset, inbox.fiscalState, inbox.accountingState]);
    if (!force && key === inbox.key) return;
    inbox.key = key;
    inbox.data = null;
    inbox.error = "";
    inbox.loading = true;
    const request = ++inbox.request;
    Promise.resolve().then(() => BlessERP.services.salesInbox.list({ search: uiState.search, offset: inbox.offset,
      fiscalState: inbox.fiscalState, accountingState: inbox.accountingState }))
      .then(data => {
        if (request !== inbox.request) return;
        if (data.companyId !== companyId || BlessERP.getFinancialV2Repository().activeCompanyUuid() !== companyId) throw new Error("La empresa activa cambio.");
        inbox.data = data;
      }).catch(error => { if (request === inbox.request) inbox.error = error.message || "No se pudo consultar la bandeja."; })
      .finally(() => {
        if (request !== inbox.request) return;
        inbox.loading = false;
        BlessERP.layout.renderPage();
      });
  }

  function inboxHtml() {
    const rows = inbox.data?.rows || [];
    return `<section class="panel-card"><div class="panel-card-head"><h3>Bandeja fiscal y contable · PRODUCTION</h3>
      <button type="button" class="secondary-button" data-inbox-refresh ${inbox.loading || inbox.posting ? "disabled" : ""}>Actualizar</button></div>
      <div class="compact-toolbar"><label>Estado fiscal<select data-inbox-fiscal><option value="">Todos</option>${["NO_DOCUMENT","BORRADOR","FIRMADO","ENVIADO_SRI","RECIBIDO_SRI","AUTORIZADO","DEVUELTO","NO_AUTORIZADO","ANULADO"].map(value=>`<option ${inbox.fiscalState===value ? "selected" : ""}>${value}</option>`).join("")}</select></label>
      <label>Estado contable<select data-inbox-accounting><option value="">Todos</option>${["NO_DOCUMENT","PENDING","POSTED","POSTED_LEGACY","REVERSED","CANCELLED","REVIEW_LINKS","REVIEW_LEGACY"].map(value=>`<option ${inbox.accountingState===value ? "selected" : ""}>${value}</option>`).join("")}</select></label></div>
      ${inbox.loading ? `<p role="status">Consultando pendientes...</p>` : inbox.error ? `<p class="inline-feedback error" role="alert">${esc(inbox.error)}</p>` : `
      <div class="compact-table-wrap"><table class="compact-table"><thead><tr><th>Documento / reserva</th><th>Pedido</th><th>Cliente</th><th>Tipo</th><th>Fiscal</th><th>Contable</th><th>Total</th><th>Revision / accion</th></tr></thead>
      <tbody>${rows.map(row => {
        const action = BlessERP.services.salesInbox.prepare(row, inbox.data);
        return `<tr><td>${esc(row.document?.full_number || row.documentNumber)}<small>${esc(row.reservationState || "")}</small></td>
        <td>${esc(row.orderNumber || row.orderId || "")}<small>${esc(row.orderState || "")}</small></td>
        <td>${esc(row.document?.buyer_snapshot?.legalName || "")}</td><td>${esc(row.document?.document_type || "Reserva 01")}</td>
        <td>${esc(row.fiscalState)}</td><td>${esc(row.accountingState)}<small>${esc(row.legacyStatus ? `Legacy: ${row.legacyStatus}` : "")}</small></td>
        <td>${row.document ? money(row.document.grand_total) : ""}</td><td>${action.ok
          ? `<button type="button" class="secondary-button compact-button" data-inbox-post="${esc(row.document.id)}" ${inbox.posting ? "disabled" : ""}>Contabilizar${row.document.document_type === "04" ? " NC" : ""}</button>`
          : esc(action.message)}</td></tr>`;
      }).join("") || `<tr><td colspan="8">Sin documentos para esta busqueda.</td></tr>`}</tbody></table></div>
      <div class="compact-toolbar"><button type="button" class="secondary-button" data-inbox-prev ${inbox.offset === 0 ? "disabled" : ""}>Anterior</button>
      <span>${Number(inbox.data?.total || 0)} ciclos</span><button type="button" class="secondary-button" data-inbox-next ${inbox.offset + 50 >= Number(inbox.data?.total || 0) ? "disabled" : ""}>Siguiente</button></div>`}</section>`;
  }

  function money(value) {
    return new Intl.NumberFormat("es-EC", { style: "currency", currency: "USD" }).format(Number(value || 0));
  }

  function pick(doc, selector) {
    return String(doc.querySelector(selector)?.textContent || "").trim();
  }

  function isoDate(value) {
    const text = String(value || "").trim();
    const match = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    return match ? `${match[3]}-${match[2]}-${match[1]}` : text.slice(0, 10);
  }

  async function parseInvoiceFile(file) {
    const parser = new DOMParser();
    const outer = parser.parseFromString(await file.text(), "application/xml");
    if (outer.querySelector("parsererror")) throw new Error(`${file.name}: XML inválido.`);
    let invoice = outer;
    const wrapped = pick(outer, "autorizacion > comprobante");
    if (wrapped) {
      const inner = parser.parseFromString(wrapped, "application/xml");
      if (!inner.querySelector("parsererror")) invoice = inner;
    }
    if (!invoice.querySelector("factura")) throw new Error(`${file.name}: no corresponde a una factura de venta.`);
    const estab = pick(invoice, "infoTributaria > estab").padStart(3, "0");
    const point = pick(invoice, "infoTributaria > ptoEmi").padStart(3, "0");
    const sequential = pick(invoice, "infoTributaria > secuencial").padStart(9, "0");
    const taxId = pick(invoice, "infoFactura > identificacionComprador");
    const name = pick(invoice, "infoFactura > razonSocialComprador") || "Cliente XML";
    const issueDate = isoDate(pick(invoice, "infoFactura > fechaEmision"));
    return {
      fileName: file.name,
      taxId,
      name,
      issueDate,
      documentNumber: `${estab}-${point}-${sequential}`,
      total: Number(pick(invoice, "infoFactura > importeTotal") || 0),
      accessKey: pick(invoice, "infoTributaria > claveAcceso"),
      authorizationNumber: pick(outer, "autorizacion > numeroAutorizacion"),
      address: pick(invoice, "infoFactura > direccionComprador"),
      email: Array.from(invoice.querySelectorAll("infoAdicional campoAdicional")).find(node => /correo|email/i.test(node.getAttribute("nombre") || ""))?.textContent?.trim() || ""
    };
  }

  function saveOpeningInvoice(parsed) {
    const service = receivables();
    const duplicate = service.receivableDocuments().find(row =>
      row.documentNumber === parsed.documentNumber
      && (!parsed.taxId || row.customerTaxId === parsed.taxId)
    );
    if (duplicate) return { ok: true, duplicate: true, receivable: duplicate };
    let customer = parsed.taxId ? service.findCustomerByTaxId(parsed.taxId) : null;
    if (!customer) {
      const savedCustomer = service.saveCustomer({
        taxId: parsed.taxId,
        name: parsed.name,
        customerType: parsed.taxId?.startsWith("CE") ? "exterior" : "local",
        country: parsed.taxId?.startsWith("CE") ? "Exterior" : "Ecuador",
        address: parsed.address,
        email: parsed.email,
        status: "activo",
        observation: `Creado desde saldo inicial XML ${parsed.documentNumber}.`
      });
      if (!savedCustomer.ok) return savedCustomer;
      customer = savedCustomer.customer;
    }
    const draft = service.emptyReceivable(customer.id);
    return service.saveReceivable({
      ...draft,
      customerId: customer.id,
      customerName: customer.name,
      customerTaxId: customer.taxId,
      customerCountry: customer.country,
      documentType: "factura sri",
      documentNumber: parsed.documentNumber,
      issueDate: parsed.issueDate,
      dueDate: parsed.issueDate,
      concept: `Saldo inicial de venta importado desde ${parsed.fileName}`,
      total: parsed.total,
      status: "PENDIENTE",
      source: "XML_SALDO_INICIAL",
      authorizationNumber: parsed.authorizationNumber,
      accessKey: parsed.accessKey,
      observation: "Factura de venta histórica importada mediante XML."
    });
  }

  async function importSales(files) {
    uiState.error = "";
    uiState.message = "";
    uiState.importing = true;
    BlessERP.layout.renderPage();
    let imported = 0;
    let duplicates = 0;
    const errors = [];
    for (const file of files) {
      try {
        const result = saveOpeningInvoice(await parseInvoiceFile(file));
        if (!result.ok) throw new Error(result.errors?.join(" ") || result.message || "No se pudo guardar la factura.");
        if (result.duplicate) duplicates += 1;
        else imported += 1;
      } catch (error) {
        errors.push(error.message || String(error));
      }
    }
    uiState.importing = false;
    uiState.message = `${imported} factura(s) importada(s) y conectada(s) a Ventas.${duplicates ? ` ${duplicates} duplicada(s) omitida(s).` : ""}`;
    uiState.error = errors.join(" ");
    BlessERP.layout.renderPage();
  }

  async function importRetentions(files) {
    uiState.error = "";
    const parsed = [];
    for (const file of files) parsed.push(await withholdings().parseRetentionXmlFile(file));
    const result = withholdings().importReceivedXmlBatch(parsed);
    let linked = 0;
    withholdings().receivedWithholdings().filter(row =>
      row.status === "IMPORTADO" && row.suggestedReceivableId
    ).forEach(row => {
      const applied = withholdings().applyReceivedWithholding(row.id, row.suggestedReceivableId);
      if (applied.ok) linked += 1;
    });
    uiState.message = `${result.imported || 0} retención(es) importada(s); ${linked} conectada(s) automáticamente a su factura.`;
    uiState.error = parsed.filter(item => !item.ok).map(item => item.error).filter(Boolean).join(" ");
    BlessERP.layout.renderPage();
  }

  function filteredRows() {
    return receivables().receivables({ search: uiState.search, status: uiState.status })
      .filter(row => row.documentType === "factura sri")
      // Native fiscal cycles belong to the canonical inbox, not this local/imported list.
      .filter(row => row.source !== "SRI_AUTORIZADO" && !row.sourceDocumentId && !row.electronicDocumentId)
      .filter(row => !uiState.accountingStatus || row.postingStatus === uiState.accountingStatus);
  }

  function reconcileAuthorizedSales() {
    if (uiState.reconciled) return;
    uiState.reconciled = true;
    // La pantalla solo consulta pendientes. Realtime/refetch nunca contabiliza.
  }

  function accountingBadge(row) {
    const status = String(row.postingStatus || "NO_CONTABILIZADO").toUpperCase();
    const css = status === "CONTABILIZADO" ? "authorized" : status === "ERROR" ? "cancelled" : "pending";
    return `<span class="status-badge ${css}">${esc(status)}</span>${row.journalEntryNumber ? `<small>Asiento ${esc(row.journalEntryNumber)}</small>` : row.accountingError ? `<small title="${esc(row.accountingError)}">${esc(row.accountingError)}</small>` : ""}`;
  }

  function render(container, route) {
    reconcileAuthorizedSales();
    loadInbox();
    const rows = filteredRows();
    const retentionRows = withholdings().receivedWithholdings();
    const salesPage = BlessERP.performance.paginate(rows, "accounting-sales", { pageSize: 50 });
    const retentionPage = BlessERP.performance.paginate(retentionRows, "accounting-sales-retentions", { pageSize: 50 });
    container.innerHTML = `
      <section class="module-hero compact-module-hero">
        <div><p class="section-kicker">CONTABILIDAD / VENTAS</p><h2>${esc(route.title)}</h2><p>${esc(route.description)}</p></div>
        <span class="status-badge authorized">Ventas</span>
      </section>
      ${uiState.error ? `<section class="inline-feedback error">${esc(uiState.error)}</section>` : ""}
      ${uiState.message ? `<section class="inline-feedback success">${esc(uiState.message)}</section>` : ""}
      <section class="panel-card compact-toolbar-card">
        <div class="compact-toolbar">
          <label class="compact-inline-field"><span>Buscar factura o cliente</span><input id="accounting-sales-search" value="${esc(uiState.search)}"></label>
          <label class="compact-inline-field"><span>Estado</span><select id="accounting-sales-status"><option value="">Todos</option>${["PENDIENTE","PARCIAL","COBRADO","VENCIDO","ANULADO"].map(value => `<option ${uiState.status === value ? "selected" : ""}>${value}</option>`).join("")}</select></label>
          <label class="compact-inline-field"><span>Contabilidad</span><select id="accounting-sales-posting-status"><option value="">Todos</option>${["CONTABILIZADO","NO_CONTABILIZADO","ERROR"].map(value => `<option ${uiState.accountingStatus === value ? "selected" : ""}>${value}</option>`).join("")}</select></label>
          <div class="compact-toolbar-actions">
            <label class="secondary-button file-button">Subir ventas XML<input hidden type="file" accept=".xml,text/xml,application/xml" multiple data-sales-opening-xml></label>
            <label class="secondary-button file-button">Subir retenciones XML<input hidden type="file" accept=".xml,text/xml,application/xml" multiple data-sales-retention-xml></label>
            <button class="primary-button" type="button" data-route-link="portfolios-collections-single">Registrar cobro</button>
          </div>
        </div>
      </section>
      ${inboxHtml()}
      <section class="summary-grid">
        <article class="summary-card"><span>Facturas</span><strong>${rows.length}</strong><small>Autorizadas o saldos iniciales XML</small></article>
        <article class="summary-card"><span>Pendientes contables</span><strong>${rows.filter(row => row.source === "SRI_AUTORIZADO" && row.postingStatus !== "CONTABILIZADO").length}</strong><small>Con error o pendientes de reintento</small></article>
        <article class="summary-card"><span>Valor facturado</span><strong>${money(rows.reduce((sum,row)=>sum+Number(row.total||0),0))}</strong></article>
        <article class="summary-card"><span>Notas de crédito</span><strong>${money(rows.reduce((sum,row)=>sum+Number(row.credited||0),0))}</strong></article>
        <article class="summary-card"><span>Retenciones</span><strong>${money(rows.reduce((sum,row)=>sum+Number(row.withheld||0),0))}</strong></article>
        <article class="summary-card"><span>Saldo por cobrar</span><strong>${money(rows.reduce((sum,row)=>sum+Number(row.balance||0),0))}</strong></article>
      </section>
      <section class="panel-card">
        <div class="panel-card-head"><div><p class="section-kicker">REGISTROS LOCALES / IMPORTADOS</p><h3>Facturas y documentos aplicados</h3></div></div>
        <div class="compact-table-wrap"><table class="compact-table">
          <thead><tr><th>Fecha</th><th>Factura</th><th>Cliente</th><th>Total</th><th>Nota crédito</th><th>Retención</th><th>Cobrado</th><th>Saldo</th><th>Cartera</th><th>Contabilidad</th><th>Acción</th></tr></thead>
          <tbody>${salesPage.items.map(row => { const pendingNote = (row.creditNotes || []).find(note => note.status === "AUTORIZADO" && !note.journalEntryId); return `<tr><td>${esc(row.issueDate)}</td><td><strong>${esc(row.documentNumber)}</strong><small>${esc(row.authorizationNumber || row.source)}</small></td><td>${esc(row.customerName)}<small>${esc(row.customerTaxId)}</small></td><td>${money(row.total)}</td><td>${money(row.credited)}</td><td>${money(row.withheld)}</td><td>${money(row.collected)}</td><td><strong>${money(row.balance)}</strong></td><td><span class="status-badge ${row.status === "COBRADO" ? "authorized" : row.status === "ANULADO" ? "cancelled" : "pending"}">${esc(row.status)}</span></td><td>${accountingBadge(row)}</td><td><div class="table-actions">${row.source === "SRI_AUTORIZADO" && row.postingStatus !== "CONTABILIZADO" ? `<button type="button" class="secondary-button compact-button" data-sales-post="${esc(row.id)}">Contabilizar</button>` : ""}${pendingNote ? `<button type="button" class="secondary-button compact-button" data-credit-note-post="${esc(row.id)}" data-credit-note-id="${esc(pendingNote.id)}">Contabilizar NC</button>` : ""}${row.journalEntryId ? `<button type="button" class="ghost-button compact-button" data-route-link="accounting-journal">Libro diario</button>` : ""}</div></td></tr>`; }).join("") || `<tr><td colspan="11"><div class="empty-state">No existen facturas de venta contables para los filtros elegidos.</div></td></tr>`}</tbody>
        </table></div>
        ${BlessERP.performance.renderPager(salesPage)}
      </section>
      <section class="panel-card">
        <div class="panel-card-head"><div><p class="section-kicker">RETENCIONES RECIBIDAS</p><h3>Relación con facturas de venta</h3></div><span class="status-badge partial">${retentionRows.length}</span></div>
        <div class="compact-table-wrap"><table class="compact-table"><thead><tr><th>Fecha</th><th>Retención</th><th>Cliente</th><th>Factura relacionada</th><th>Renta</th><th>IVA</th><th>Estado</th></tr></thead><tbody>${retentionPage.items.map(row => `<tr><td>${esc(row.issueDate)}</td><td>${esc(row.documentNumber)}</td><td>${esc(row.issuerName)}<small>${esc(row.issuerTaxId)}</small></td><td>${esc(row.relatedReceivableNumber || row.suggestedReceivableNumber || row.supportDocumentNumber || "Pendiente")}</td><td>${money(row.totalRent)}</td><td>${money(row.totalVat)}</td><td><span class="status-badge ${row.status === "APLICADO" ? "authorized" : "pending"}">${esc(row.status)}</span></td></tr>`).join("") || `<tr><td colspan="7"><div class="empty-state">No existen retenciones recibidas.</div></td></tr>`}</tbody></table></div>
        ${BlessERP.performance.renderPager(retentionPage)}
      </section>`;

    document.querySelector("#accounting-sales-search")?.addEventListener("input", BlessERP.performance.debounce(event => {
      uiState.search = event.target.value;
      inbox.offset = 0;
      BlessERP.performance.resetPage("accounting-sales");
      BlessERP.layout.renderPage();
    }, 200));
    document.querySelector("#accounting-sales-status")?.addEventListener("change", event => {
      uiState.status = event.target.value;
      BlessERP.performance.resetPage("accounting-sales");
      BlessERP.layout.renderPage();
    });
    document.querySelector("#accounting-sales-posting-status")?.addEventListener("change", event => {
      uiState.accountingStatus = event.target.value;
      BlessERP.performance.resetPage("accounting-sales");
      BlessERP.layout.renderPage();
    });
    document.querySelectorAll("[data-sales-post]").forEach(button => button.addEventListener("click", async () => {
      button.disabled = true;
      const result = await receivables().postReceivableV2(button.dataset.salesPost);
      uiState.message = result.ok ? `Venta contabilizada con asiento ${result.entry?.entryNumber || result.receivable?.journalEntryNumber || "asignado"}.` : "";
      uiState.error = result.ok ? "" : (result.errors?.join(" ") || result.message || "No se pudo contabilizar la venta.");
      BlessERP.layout.renderPage();
    }));
    document.querySelectorAll("[data-credit-note-post]").forEach(button => button.addEventListener("click", async () => {
      button.disabled = true;
      const result = await receivables().postCreditNoteV2(button.dataset.creditNotePost, button.dataset.creditNoteId);
      uiState.message = result.ok ? `Nota de crédito contabilizada con asiento ${result.entry?.entryNumber || "asignado"}.` : "";
      uiState.error = result.ok ? "" : (result.errors?.join(" ") || result.message || "No se pudo contabilizar la nota de crédito.");
      BlessERP.layout.renderPage();
    }));
    document.querySelector("[data-sales-opening-xml]")?.addEventListener("change", event => importSales(Array.from(event.target.files || [])));
    document.querySelector("[data-sales-retention-xml]")?.addEventListener("change", event => importRetentions(Array.from(event.target.files || [])));
    container.querySelector("[data-inbox-refresh]")?.addEventListener("click", () => { loadInbox(true); BlessERP.layout.renderPage(); });
    container.querySelector("[data-inbox-fiscal]")?.addEventListener("change", event => { inbox.fiscalState = event.target.value; inbox.offset = 0; BlessERP.layout.renderPage(); });
    container.querySelector("[data-inbox-accounting]")?.addEventListener("change", event => { inbox.accountingState = event.target.value; inbox.offset = 0; BlessERP.layout.renderPage(); });
    container.querySelector("[data-inbox-prev]")?.addEventListener("click", () => { inbox.offset = Math.max(0, inbox.offset - 50); BlessERP.layout.renderPage(); });
    container.querySelector("[data-inbox-next]")?.addEventListener("click", () => { inbox.offset += 50; BlessERP.layout.renderPage(); });
    container.querySelectorAll("[data-inbox-post]").forEach(button => button.addEventListener("click", async () => {
      if (inbox.posting || !inbox.data) return;
      const companyId = inbox.data.companyId;
      const row = inbox.data.rows.find(item => item.document?.id === button.dataset.inboxPost);
      if (!row || !window.confirm(`Confirmar contabilizacion de ${row.document.full_number}. Esta accion crea el efecto contable; no consulta ni transmite al SRI.`)) return;
      inbox.posting = true;
      BlessERP.layout.renderPage();
      try {
        const result = await BlessERP.services.salesInbox.post(companyId, row.document.id, true);
        if (BlessERP.getFinancialV2Repository().activeCompanyUuid() === companyId) {
          uiState.message = result.ok ? "Contabilizacion confirmada por Supabase." : "";
          uiState.error = result.ok ? "" : result.errors?.join(" ") || result.message || "Contabilizacion no confirmada.";
        }
      } finally {
        inbox.posting = false;
        loadInbox(true);
        BlessERP.layout.renderPage();
      }
    }));
  }

  BlessERP.modules = BlessERP.modules || {};
  BlessERP.modules.part2SalesAccounting = { render };
})();
