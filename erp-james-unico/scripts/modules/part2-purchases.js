(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const { esc, money, clone } = BlessERP.utils;
  const purchaseService = BlessERP.services.purchases;
  const purchaseReadService = () => BlessERP.services.purchaseInvoiceReadV2;
  const today = BlessERP.utils.today();
  const monthStart = `${today.slice(0, 7)}-01`;

  const uiState = {
    invoices: {
      draftFilters: { dateFrom: monthStart, dateTo: today, dateKind: "ISSUE", supplierId: "", status: "", documentType: "", postingState: "", retentionStatus: "", documentNumber: "", search: "" },
      pageSize: 25,
      message: "",
      errors: []
    },
    manual: {
      draft: null,
      mode: "new",
      message: "",
      errors: [],
      transientXmlReview: false
    },
    xml: {
      batch: [],
      message: "",
      errors: [],
      loading: false
    },
    retentions: {
      draft: null,
      purchaseFilter: "",
      typeFilter: "",
      message: "",
      errors: [],
      trackingOpen: false,
      statusOpen: false,
      processing: false
    },
    report: {
      draftFilters: {
        dateFrom: monthStart,
        dateTo: today,
        type: "ALL",
        status: "",
        supplierId: "",
        customerId: "",
        retentionCode: "",
        retentionNumber: "",
        documentNumber: "",
        search: ""
      },
      pageSize: 25,
      message: "",
      errors: [],
      exporting: false
    },
    settlements: {
      view: "FORM",
      providerId: "",
      periodStart: "",
      periodEnd: "",
      dueDate: "",
      settlementMethod: "PER_STEM",
      costAccountCode: "",
      payableAccountCode: "",
      message: "",
      errors: [],
      historyDraftFilters: { dateFrom: "", dateTo: "", providerId: "", status: "", reference: "", search: "" },
      historyPageSize: 25
    }
  };

  function routeTabs(route) {
    return "";
  }

  function statusBadge(status) {
    const value = String(status || "").toLowerCase();
    const css = value.includes("anulado") || value.includes("error")
      ? "cancelled"
      : value.includes("borrador") || value.includes("pendiente")
        ? "pending"
      : value.includes("retenido") || value.includes("contabilizado") || value.includes("importado") || value.includes("valido") || value.includes("activo") || value.includes("autorizada")
          ? "authorized"
          : "partial";
    return `<span class="status-badge ${css}">${esc(status)}</span>`;
  }

  function suppliersOptions() {
    return purchaseService.providers();
  }

  function xmlPurchaseKey(purchase = {}) {
    const sourceKey = String(purchase.sourceKey || purchase.duplicateKey || "").trim();
    if (sourceKey) return `SOURCE|${sourceKey}`;
    const accessKey = String(purchase.accessKey || "").trim();
    if (accessKey) return `ACCESS|${accessKey}`;
    const parts = [
      String(purchase.supplierRuc || "").trim(),
      String(purchase.voucherType || "").trim(),
      String(purchase.estab || "").trim(),
      String(purchase.ptoEmi || "").trim(),
      String(purchase.sequential || "").trim(),
      String(purchase.authorizationNumber || "").trim()
    ];
    return parts.some(Boolean) ? parts.join("|") : "";
  }

  function markXmlBatchImported(sourceBatch = [], result = {}) {
    const rows = Array.isArray(result.results) ? result.results : [];
    sourceBatch.forEach((item, index) => {
      const imported = rows[index];
      if (!item || !imported?.imported) return;
      item.importStatus = "IMPORTADO";
      item.importedPurchaseId = imported.purchaseId || item.purchase?.id || "";
      if (item.purchase) item.purchase.importStatus = "IMPORTADO";
    });
  }

  function clearAccountedXmlReview(purchase = {}) {
    const purchaseId = String(purchase.id || "").trim();
    const purchaseKey = xmlPurchaseKey(purchase);
    const before = uiState.xml.batch.length;
    uiState.xml.batch = uiState.xml.batch.filter(item => {
      if (!item?.purchase) return true;
      const importedId = String(item.importedPurchaseId || item.purchase.id || "").trim();
      if (purchaseId && importedId === purchaseId) return false;
      return !purchaseKey || xmlPurchaseKey(item.purchase) !== purchaseKey;
    });
    const removed = before - uiState.xml.batch.length;
    if (removed > 0) {
      uiState.xml.message = `Compra ${purchase.documentNumber || "XML"} contabilizada y retirada de Documentos leidos antes de guardar.`;
    }
    return removed;
  }

  function ensureManualDraft(purchase = null, mode = "new", options = {}) {
    uiState.manual.mode = mode;
    uiState.manual.errors = [];
    uiState.manual.message = "";
    uiState.manual.transientXmlReview = options.transientXmlReview === true;
    uiState.manual.draft = purchase ? purchaseService.normalizePurchase(clone(purchase)) : purchaseService.emptyPurchase();
    if (BlessERP.services.purchaseAccountContract?.enabled()) uiState.manual.draft = purchaseService.normalizePurchase(uiState.manual.draft);
  }

  function ensureRetentionDraft(purchaseId = "") {
    uiState.retentions.errors = [];
    uiState.retentions.message = "";
    uiState.retentions.draft = syncRetentionDraftDerivedValues(
      purchaseService.emptyRetentionDraft(purchaseId),
      { forcePurchaseDefaults: Boolean(purchaseId) }
    );
  }

  function purchaseSummaryCards(summary = {}, loaded = false) {
    if (!loaded) return "";
    return `
      <section class="summary-grid summary-grid-purchases">
        <article class="summary-card"><span>Documentos</span><strong>${esc(String(summary.documents || 0))}</strong><small>Universo consultado</small></article>
        <article class="summary-card"><span>Total</span><strong>${money(summary.total || 0)}</strong><small>Según filtros aplicados</small></article>
        <article class="summary-card"><span>Contabilizadas</span><strong>${esc(String(summary.posted || 0))}</strong><small>Resumen server-side</small></article>
        <article class="summary-card"><span>Pendientes</span><strong>${esc(String(summary.pending || 0))}</strong><small>Sin contabilizar</small></article>
        <article class="summary-card"><span>Con retencion</span><strong>${esc(String(summary.withRetention || 0))}</strong><small>Vinculo resumido</small></article>
        <article class="summary-card"><span>Historico legacy</span><strong>${esc(String(summary.legacy || 0))}</strong><small>Solo compatibilidad</small></article>
      </section>
    `;
  }

  function purchaseDocumentLabel(value) {
    const labels = { INVOICE: "Factura", PURCHASE_SETTLEMENT: "Liquidacion de compra", CREDIT_NOTE: "Nota de credito", SALES_NOTE: "Nota de venta", OTHER: "Otro", OPENING_BALANCE: "Saldo inicial" };
    return labels[String(value || "").toUpperCase()] || purchaseService.voucherLabel(String(value || "").toLowerCase()) || value || "-";
  }

  function renderPurchaseTableRows(rows) {
    return rows.map(item => `
      <tr>
        <td>${esc(item.issueDate || "-")}<small>Contable: ${esc(item.accountingDate || "-")}</small></td>
        <td>${esc(item.supplierRuc)}</td>
        <td><strong>${esc(item.supplierName)}</strong></td>
        <td><strong>${esc(item.documentNumber || "-")}</strong><small>${esc(purchaseDocumentLabel(item.documentType))} · ${money(item.total)}</small></td>
        <td>${statusBadge(item.status || "-")}<small>${esc(item.accountingStatus || "")}</small></td>
        <td>${statusBadge(item.retentionStatus || "SIN DEFINIR")}</td>
        <td>
          <div class="row-actions">
            <button class="row-action-button" type="button" data-purchase-view="${esc(item.id)}" data-purchase-source="${esc(item.source)}">Ver detalle</button>
            ${["BORRADOR", "REVISADO", "XML_LEIDO", "PENDIENTE_CLASIFICACION"].includes(item.status) ? `<button class="row-action-button" type="button" data-purchase-edit="${esc(item.id)}" data-purchase-source="${esc(item.source)}">Revisar y contabilizar</button>` : ""}
            ${item.status === "PENDIENTE_RETENCION" && item.canonical ? `<button class="row-action-button" type="button" data-purchase-retention="${esc(item.id)}">Crear retencion</button>` : ""}
            ${item.status !== "ANULADO" ? `<button class="row-action-button danger" type="button" data-purchase-delete="${esc(item.id)}" data-purchase-source="${esc(item.source)}">${["BORRADOR", "REVISADO", "XML_LEIDO", "PENDIENTE_CLASIFICACION"].includes(item.status) ? "Eliminar" : "Anular"}</button>` : ""}
          </div>
        </td>
      </tr>
    `).join("") || `<tr><td colspan="7"><div class="empty-inline">No hay compras para los filtros aplicados.</div></td></tr>`;
  }

  function renderPurchaseDetail(detail, xml) {
    if (!detail?.purchase) return "";
    const p = detail.purchase;
    const lines = detail.lines || p.lines || [];
    return `<section class="panel-card" data-purchase-detail-panel>
      <div class="panel-card-head"><div><p class="section-kicker">DETALLE LAZY</p><h3>${esc(p.documentNumber || p.id)}</h3></div><button class="secondary-button" type="button" data-purchase-detail-close>Cerrar</button></div>
      <div class="summary-grid"><article class="summary-card"><span>Proveedor</span><strong>${esc(p.supplierName || "-")}</strong><small>${esc(p.supplierRuc || "")}</small></article>
        <article class="summary-card"><span>Total</span><strong>${money(p.totals?.total || 0)}</strong><small>${esc(p.status || "")}</small></article>
        <article class="summary-card"><span>CxP</span><strong>${esc(detail.payable?.status || "No vinculada")}</strong><small>${detail.payable?.balance != null ? money(detail.payable.balance) : ""}</small></article>
        <article class="summary-card"><span>Retencion</span><strong>${esc(detail.retention?.document?.status || p.retentionStatus || "No vinculada")}</strong><small>${esc(detail.retention?.document?.sequential || "")}</small></article>
        <article class="summary-card"><span>Asiento</span><strong>${esc(detail.journal?.number || "No vinculado")}</strong><small>${esc(detail.journal?.status || "")}</small></article></div>
      <div class="compact-table-wrap"><table class="compact-table"><thead><tr><th>Codigo</th><th>Detalle</th><th>Cantidad</th><th>Base</th><th>IVA</th><th>Total</th></tr></thead><tbody>
        ${lines.map(line => `<tr><td>${esc(line.productCode || "-")}</td><td>${esc(line.description || "-")}</td><td>${esc(String(line.quantity || 0))}</td><td>${money(line.taxableBase || 0)}</td><td>${money(line.vatValue || 0)}</td><td>${money(line.totalLine || 0)}</td></tr>`).join("") || `<tr><td colspan="6">Sin lineas.</td></tr>`}
      </tbody></table></div>
      <div class="compact-toolbar-actions"><button class="secondary-button" type="button" data-purchase-xml-load="${esc(p.id)}" data-purchase-source="${esc(detail.source || p.sourceKind || "SUPPLIER_FINANCE_V2")}">Ver XML / payload origen</button></div>
      ${xml?.sourcePayload ? `<details open><summary>XML / payload solicitado</summary><pre class="technical-pre">${esc(JSON.stringify(xml.sourcePayload, null, 2))}</pre></details>` : ""}
    </section>`;
  }

  function renderInvoices(container, route) {
    const service = purchaseReadService();
    service?.setActiveRoute?.(route.id);
    const readState = service?.snapshot?.() || { history: { items: [], total: 0, page: 1, pageSize: uiState.invoices.pageSize, loaded: false, loading: false, summary: {} }, error: "" };
    if (!readState.started) void service?.start?.(() => BlessERP.layout.renderPage());
    const history = readState.history;
    const filters = uiState.invoices.draftFilters;
    const pageCount = Math.max(1, Math.ceil(Number(history.total || 0) / Number(history.pageSize || 25)));
    container.innerHTML = `
      <section class="page-header">
        <div>
          <p class="section-kicker">${esc(route.groupLabel.toUpperCase())}</p>
          <h1>${esc(route.title)}</h1>
          <p>${esc(route.description)}</p>
        </div>
        <div class="page-header-side">
          <span class="status-badge authorized">Flujo base activo</span>
        </div>
      </section>
      ${routeTabs(route)}
      ${uiState.invoices.message ? `<section class="inline-feedback success">${esc(uiState.invoices.message)}</section>` : ""}
      ${(uiState.invoices.errors || []).map(error => `<section class="inline-feedback error">${esc(error)}</section>`).join("")}
      ${readState.error ? `<section class="inline-feedback error">${esc(readState.error)}</section>` : ""}
      ${purchaseSummaryCards(history.summary, history.loaded)}
      <section class="panel-card compact-toolbar-card">
        <div class="compact-toolbar compact-toolbar-purchases">
          <label class="compact-inline-field"><span>Desde</span><input id="purchase-date-from" type="date" value="${esc(filters.dateFrom)}"></label>
          <label class="compact-inline-field"><span>Hasta</span><input id="purchase-date-to" type="date" value="${esc(filters.dateTo)}"></label>
          <label class="compact-inline-field"><span>Fecha del rango</span><select id="purchase-date-kind"><option value="ISSUE" ${filters.dateKind === "ISSUE" ? "selected" : ""}>Emision</option><option value="ACCOUNTING" ${filters.dateKind === "ACCOUNTING" ? "selected" : ""}>Contabilizacion</option></select></label>
          <label class="compact-inline-field">
            <span>Buscar</span>
            <input id="purchase-search" placeholder="Proveedor, RUC, numero o autorizacion" value="${esc(filters.search)}">
          </label>
          <label class="compact-inline-field">
            <span>Estado</span>
            <select id="purchase-status-filter">
              <option value="">Todos</option>
              ${purchaseService.purchaseStatuses.map(status => `<option value="${esc(status)}" ${filters.status === status ? "selected" : ""}>${esc(status)}</option>`).join("")}
            </select>
          </label>
          <label class="compact-inline-field">
            <span>Tipo documento</span>
            <select id="purchase-type-filter">
              <option value="">Todos</option>
              ${[{code:"INVOICE",label:"Factura"},{code:"PURCHASE_SETTLEMENT",label:"Liquidacion de compra"},{code:"CREDIT_NOTE",label:"Nota de credito"},{code:"SALES_NOTE",label:"Nota de venta"},{code:"OTHER",label:"Otro"},{code:"OPENING_BALANCE",label:"Saldo inicial"}].map(type => `<option value="${type.code}" ${filters.documentType === type.code ? "selected" : ""}>${type.label}</option>`).join("")}
            </select>
          </label>
          <label class="compact-inline-field">
            <span>Proveedor</span>
            <select id="purchase-supplier-filter">
              <option value="">Todos</option>
              ${suppliersOptions().map(item => `<option value="${esc(item.id)}" ${filters.supplierId === item.id ? "selected" : ""}>${esc(item.name)}</option>`).join("")}
            </select>
          </label>
          <label class="compact-inline-field"><span>Contabilizacion</span><select id="purchase-posting-filter"><option value="">Todas</option><option value="PENDIENTE" ${filters.postingState === "PENDIENTE" ? "selected" : ""}>Pendiente</option><option value="CONTABILIZADA" ${filters.postingState === "CONTABILIZADA" ? "selected" : ""}>Contabilizada</option><option value="ANULADA" ${filters.postingState === "ANULADA" ? "selected" : ""}>Anulada</option></select></label>
          <label class="compact-inline-field"><span>Retencion</span><select id="purchase-retention-filter"><option value="">Todas</option>${["PENDING_DECISION","PENDING_ISSUANCE","NOT_REQUIRED","DRAFT_CREATED","PROCESSING","AUTHORIZED","RETURNED","NOT_AUTHORIZED","ERROR","CANCELLED"].map(value => `<option value="${value}" ${filters.retentionStatus === value ? "selected" : ""}>${value}</option>`).join("")}</select></label>
          <label class="compact-inline-field"><span>Documento</span><input id="purchase-document-filter" value="${esc(filters.documentNumber)}" placeholder="Numero"></label>
          <label class="compact-inline-field"><span>Filas</span><select id="purchase-page-size"><option value="25" ${uiState.invoices.pageSize === 25 ? "selected" : ""}>25</option><option value="50" ${uiState.invoices.pageSize === 50 ? "selected" : ""}>50</option></select></label>
          <div class="compact-toolbar-actions">
            <button class="primary-button" type="button" data-purchase-query ${history.loading ? "disabled" : ""}>${history.loading ? "Consultando…" : "Consultar"}</button>
            <button class="secondary-button" type="button" data-purchase-new>Nueva compra</button>
            <button class="secondary-button" type="button" data-route-link="purchases-upload-xml">Subir XML</button>
            ${history.loaded ? `<button class="secondary-button" type="button" data-purchases-export>Exportar consulta XLSX</button>` : ""}
          </div>
        </div>
      </section>
      <article class="panel-card">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">CONSULTA</p>
            <h3>Facturas de compra</h3>
          </div>
          <span class="status-badge partial">${history.loaded ? `${esc(String(history.total))} resultado(s)` : "0 historial cargado"}</span>
        </div>
        <div class="compact-table-wrap">
          <table class="compact-table compact-table-purchases">
            <thead>
              <tr>
                <th>Fecha emision</th>
                <th>RUC</th>
                <th>Proveedor</th>
                <th>Numero de factura o documento</th>
                <th>Estado</th>
                <th>Estado de retencion</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>${history.loaded ? renderPurchaseTableRows(history.items) : `<tr><td colspan="7"><div class="empty-inline">Selecciona filtros y pulsa Consultar.</div></td></tr>`}</tbody>
          </table>
        </div>
        ${history.loaded ? `<div class="pagination-bar"><span>Mostrando ${history.total ? (history.page - 1) * history.pageSize + 1 : 0}–${Math.min(history.page * history.pageSize, history.total)} de ${history.total} · Pagina ${history.page} de ${pageCount}</span><div><button class="secondary-button" type="button" data-purchase-page="${history.page - 1}" ${history.page <= 1 ? "disabled" : ""}>Anterior</button><button class="secondary-button" type="button" data-purchase-page="${history.page + 1}" ${history.page >= pageCount ? "disabled" : ""}>Siguiente</button></div></div>` : ""}
      </article>
      ${renderPurchaseDetail(readState.detail, readState.xml)}
    `;
    bindInvoices();
  }

  function renderManualHeaderFields(draft, readOnly) {
    return `
      <div class="compact-form-grid purchase-form-grid">
        <label class="compact-field">
          <span>Proveedor</span>
          <select name="supplierId" ${readOnly ? "disabled" : ""}>
            <option value="">Seleccionar proveedor</option>
            ${suppliersOptions().map(item => `<option value="${esc(item.id)}" ${draft.supplierId === item.id ? "selected" : ""}>${esc(item.name)}</option>`).join("")}
          </select>
        </label>
        <label class="compact-field"><span>${draft.voucherType === "documento_exterior" ? "Identificacion proveedor exterior" : "RUC proveedor"}</span><input name="supplierRuc" value="${esc(draft.supplierRuc)}" ${readOnly ? "readonly" : ""}></label>
        <label class="compact-field"><span>Fecha emision</span><input name="issueDate" type="date" value="${esc(draft.issueDate)}" ${readOnly ? "disabled" : ""}></label>
        <label class="compact-field"><span>Fecha contabilizacion</span><input name="accountingDate" type="date" value="${esc(draft.accountingDate)}" ${readOnly ? "disabled" : ""}></label>
        <label class="compact-field">
          <span>Tipo comprobante</span>
          <select name="voucherType" ${readOnly ? "disabled" : ""}>
            ${purchaseService.voucherTypes.map(item => `<option value="${esc(item.code)}" ${draft.voucherType === item.code ? "selected" : ""}>${esc(item.label)}</option>`).join("")}
          </select>
        </label>
        ${draft.voucherType === "documento_exterior" ? `
          <label class="compact-field full"><span>Numero del documento del exterior</span><input name="externalDocumentNumber" value="${esc(draft.externalDocumentNumber || "")}" placeholder="Ej. INV-US-2026-1058" ${readOnly ? "readonly" : ""}></label>
        ` : `
          <label class="compact-field"><span>Serie establecimiento</span><input name="estab" value="${esc(draft.estab)}" ${readOnly ? "readonly" : ""}></label>
          <label class="compact-field"><span>Punto emision</span><input name="ptoEmi" value="${esc(draft.ptoEmi)}" ${readOnly ? "readonly" : ""}></label>
          <label class="compact-field"><span>Secuencial</span><input name="sequential" value="${esc(draft.sequential)}" ${readOnly ? "disabled" : ""}></label>
        `}
        <label class="compact-field"><span>${draft.voucherType === "documento_exterior" ? "Referencia / autorizacion" : "Autorizacion"}</span><input name="authorizationNumber" value="${esc(draft.authorizationNumber || "")}" ${readOnly ? "disabled" : ""}></label>
        <label class="compact-field">
          <span>Sustento tributario</span>
          <select name="taxSupportCode" ${readOnly ? "disabled" : ""}>
            <option value="">Seleccionar sustento</option>
            ${BlessERP.services.purchaseAccountContract?.enabled() && !purchaseService.taxSupports().length ? [["01", "Bien/servicio con crédito"], ["02", "Bien/servicio sin crédito"], ["03", "Activo fijo con crédito"], ["04", "Activo fijo sin crédito"], ["06", "Inventario con crédito"], ["07", "Inventario sin crédito"]].map(([code,label]) => `<option value="${code}" ${draft.taxSupportCode === code ? "selected" : ""}>${code} - ${label}</option>`).join("") : ""}
            ${purchaseService.taxSupports().map(item => `<option value="${esc(item.code)}" ${draft.taxSupportCode === item.code ? "selected" : ""}>${esc(item.code)} - ${esc(item.description)}</option>`).join("")}
          </select>
        </label>
        <label class="compact-field">
          <span>Tipo compra</span>
          <select name="purchaseType" ${readOnly ? "disabled" : ""}>
            <option value="">Seleccionar tipo</option>
            ${BlessERP.services.purchaseAccountContract?.enabled() ? `<option value="MANUAL" ${draft.purchaseType === "MANUAL" ? "selected" : ""}>Cuenta económica explícita por línea</option>` : ""}
            ${purchaseService.purchaseTypes().map(item => `<option value="${esc(item.code)}" ${draft.purchaseType === item.code ? "selected" : ""}>${esc(item.label)}</option>`).join("")}
          </select>
        </label>
        <label class="compact-field"><span>Vencimiento</span><input name="dueDate" type="date" value="${esc(draft.dueDate || "")}" ${readOnly ? "disabled" : ""}></label>
        <label class="compact-field">
          <span>Forma de pago SRI</span>
          <select name="paymentMethod" ${readOnly ? "disabled" : ""}>
            <option value="">Seleccionar forma de pago</option>
            ${purchaseService.paymentMethods.map(item => `<option value="${esc(item.code)}" ${draft.paymentMethod === item.code ? "selected" : ""}>${esc(item.code)} - ${esc(item.label)}</option>`).join("")}
          </select>
        </label>
        ${renderPurchaseAccountContract(draft, readOnly)}
        <label class="compact-field">
          <span>Contrapartida contable</span>
          <select name="settlementMode" ${readOnly ? "disabled" : ""}>
            <option value="CXP" ${draft.settlementMode !== "CONTADO" ? "selected" : ""}>Cuenta por pagar a proveedor</option>
            <option value="CONTADO" ${draft.settlementMode === "CONTADO" ? "selected" : ""}>Banco o caja</option>
          </select>
        </label>
        ${draft.settlementMode === "CONTADO" ? `<label class="compact-field"><span>Banco o caja</span><select name="paymentAccountCode" ${readOnly ? "disabled" : ""}><option value="">Seleccionar</option>${(BlessERP.services.banks?.bankAccounts?.() || []).filter(item => item.status === "activa" && item.linkedAccountCode).map(item => `<option value="${esc(item.linkedAccountCode)}" ${draft.paymentAccountCode === item.linkedAccountCode ? "selected" : ""}>${esc(item.bankName)} · ${esc(item.accountNumber || item.code)}</option>`).join("")}</select></label>` : ""}
        <label class="compact-field">
          <span>Tratamiento de retencion</span>
          <select name="retentionDecision" ${readOnly ? "disabled" : ""}>
            <option value="PENDIENTE" ${draft.retentionDecision === "PENDIENTE" ? "selected" : ""}>Pendiente de decidir</option>
            <option value="APLICAR" ${draft.retentionDecision === "APLICAR" ? "selected" : ""}>Aplicar retencion</option>
            <option value="NO_SUJETO_332" ${draft.retentionDecision === "NO_SUJETO_332" ? "selected" : ""}>332 - No sujeto a retencion</option>
          </select>
        </label>
        <label class="compact-field full">
          <span>Justificacion tributaria ${draft.retentionDecision === "NO_SUJETO_332" ? "(obligatoria)" : "(opcional)"}</span>
          <textarea name="retentionDecisionReason" rows="2" ${readOnly ? "disabled" : ""}>${esc(draft.retentionDecisionReason || "")}</textarea>
        </label>
        <label class="compact-field full"><span>Observacion</span><textarea name="observation" rows="2" ${readOnly ? "disabled" : ""}>${esc(draft.observation || "")}</textarea></label>
      </div>
      ${draft.supplierAddress ? `<div class="helper-pill">Direccion proveedor: ${esc(draft.supplierAddress)}</div>` : ""}
      <div class="helper-pill">
        ${draft.retentionDecision === "NO_SUJETO_332"
          ? "El codigo 332 se reportara en el AIR del ATS con base imponible, porcentaje 0 y valor retenido 0. No genera comprobante ni asiento de retencion."
          : draft.retentionDecision === "APLICAR"
            ? "Al contabilizar, la compra quedara pendiente para seleccionar los porcentajes de renta e IVA y confirmar la retencion."
            : "Antes de contabilizar debe decidir si aplica retencion o si corresponde el codigo 332."}
      </div>
    `;
  }

  function renderPurchaseAccountContract(draft, readOnly) {
    const contract = BlessERP.services.purchaseAccountContract;
    if (!contract?.enabled()) return "";
    const selected = draft.payableAccountCode || contract.payable(draft);
    const options = contract.payableCodes.map(code => `<option value="${code}" ${selected === code ? "selected" : ""}>${code} - ${esc(BlessERP.services.chartOfAccounts.findByCode(code)?.name || code)}</option>`).join("");
    return `<label class="compact-field"><span>Cuenta CxP del proveedor</span><select name="payableAccountCode" ${readOnly ? "disabled" : ""}><option value="">Seleccionar relación / cuenta</option>${options}</select></label>
      <label class="compact-field"><span>Tratamiento del IVA</span><select name="vatCreditTreatment" ${readOnly ? "disabled" : ""}>
      <option value="PENDING">Confirmar tratamiento</option><option value="CREDIT" ${draft.vatCreditTreatment === "CREDIT" ? "selected" : ""}>Con derecho a crédito tributario</option>
      <option value="NO_CREDIT" ${draft.vatCreditTreatment === "NO_CREDIT" ? "selected" : ""} ${contract.supportsNoCredit(draft.taxSupportCode) ? "" : "disabled"}>Sin credito - IVA a la cuenta de cada linea</option></select></label>`;
  }

  function renderVatRate(line, draft, readOnly) {
    const contract = BlessERP.services.purchaseAccountContract;
    if (!contract?.enabled()) return `<input name="vatRate" type="number" step="0.01" min="0" value="${esc(String(line.vatRate || 0))}" ${readOnly ? "disabled" : ""}>`;
    if (draft.source === "XML") return `<span>${esc(String(line.vatRate))}% · código ${esc(line.vatCode)}</span>`;
    const parameters = contract.effectiveTaxes(draft.issueDate);
    const options = parameters.map(t => `<option value="${esc(t.id)}" ${line.vatParameterId === t.id ? "selected" : ""}>${esc(t.name)} — ${esc(String(t.rate))}%</option>`).join("");
    return `<select name="vatParameterId" ${readOnly ? "disabled" : ""}><option value="">Seleccione tarifa vigente</option>${options}</select>`;
  }

  function lineModeBadge(line) {
    const mode = String(line.suggestionMode || "Manual");
    const css = mode === "Automatico" ? "authorized" : mode === "Sugerido" ? "pending" : "partial";
    return `<span class="status-badge ${css}">${esc(mode)}</span>`;
  }

  function renderStandardPurchaseLines(draft, readOnly) {
    const movementAccounts = BlessERP.services.chartOfAccounts.movementOptions();
    return `
      <div class="journal-lines-head">
        <div>
          <p class="section-kicker">DETALLE</p>
          <h3>Lineas de compra</h3>
        </div>
        ${!readOnly ? `<button class="secondary-button" type="button" data-manual-add-line>Agregar linea</button>` : ""}
      </div>
      <div class="compact-table-wrap">
        <table class="compact-table compact-table-purchases-detail">
          <thead>
            <tr>
              <th>Codigo</th>
              <th>Descripcion</th>
              <th>Cant.</th>
              <th>Precio U.</th>
              <th>Desc.</th>
              <th>Base</th>
              <th>IVA %</th>
              <th>IVA valor</th>
              <th>Total linea</th>
              <th>Cuenta contable</th>
              <th>Centro costo</th>
              <th>Tipo</th>
              <th>Modo</th>
              ${!readOnly ? `<th></th>` : ""}
            </tr>
          </thead>
          <tbody>
            ${(draft.lines || []).map(line => `
              <tr data-line-id="${esc(line.id)}">
                <td><input name="productCode" value="${esc(line.productCode || "")}" ${readOnly ? "disabled" : ""}></td>
                <td><input name="description" value="${esc(line.description || "")}" ${readOnly ? "disabled" : ""}></td>
                <td><input name="quantity" type="number" step="0.01" min="0" value="${esc(String(line.quantity || 0))}" ${readOnly ? "disabled" : ""}></td>
                <td><input name="unitPrice" type="number" step="0.01" min="0" value="${esc(String(line.unitPrice || 0))}" ${readOnly ? "disabled" : ""}></td>
                <td><input name="discount" type="number" step="0.01" min="0" value="${esc(String(line.discount || 0))}" ${readOnly ? "disabled" : ""}></td>
                <td><input name="taxableBase" type="number" step="0.01" min="0" value="${esc(String(line.taxableBase || 0))}" ${readOnly ? "disabled" : ""}></td>
                <td>${renderVatRate(line, draft, readOnly)}</td>
                <td><input name="vatValue" type="number" step="0.01" min="0" value="${esc(String(line.vatValue || 0))}" ${readOnly ? "disabled" : ""}></td>
                <td><input name="totalLine" type="number" step="0.01" min="0" value="${esc(String(line.totalLine || 0))}" ${readOnly ? "disabled" : ""}></td>
                <td>
                  <select name="accountCode" ${readOnly ? "disabled" : ""}>
                    <option value="">Seleccionar cuenta</option>
                    ${movementAccounts.map(account => `<option value="${esc(account.code)}" ${line.accountCode === account.code ? "selected" : ""}>${esc(account.code)} - ${esc(account.name)}</option>`).join("")}
                  </select>
                  ${line.suggestedAccountCode ? `<small class="line-hint">Sugerida: ${esc(line.suggestedAccountCode)}</small>` : ""}
                </td>
                <td><input name="costCenter" value="${esc(line.costCenter || "")}" ${readOnly ? "disabled" : ""}></td>
                <td>
                  <select name="lineType" ${readOnly ? "disabled" : ""}>
                    ${purchaseService.lineTypes.map(type => `<option value="${esc(type)}" ${line.lineType === type ? "selected" : ""}>${esc(type)}</option>`).join("")}
                  </select>
                </td>
                <td>${lineModeBadge(line)}</td>
                ${!readOnly ? `<td><button class="row-action-button" type="button" data-manual-remove-line="${esc(line.id)}">Quitar</button></td>` : ""}
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderInventoryPurchaseLines(draft, readOnly) {
    const inventoryItems = purchaseService.inventoryItemsForPurchaseType(draft.purchaseType);
    return `
      <div class="journal-lines-head">
        <div>
          <p class="section-kicker">DETALLE INVENTARIABLE</p>
          <h3>Productos ligados a parametrizacion de inventario</h3>
        </div>
        ${!readOnly ? `<button class="secondary-button" type="button" data-manual-add-line>Agregar linea</button>` : ""}
      </div>
      <p class="panel-note purchase-lines-note">Selecciona el producto parametrizado y el sistema completara codigo, nombre y cuenta de inventario. Solo se editan cantidades, precio, IVA y centro de costo.</p>
      <div class="compact-table-wrap">
        <table class="compact-table compact-table-purchases-detail">
          <thead>
            <tr>
              <th>Producto parametrizado</th>
              <th>Codigo</th>
              <th>Nombre producto</th>
              <th>Cant.</th>
              <th>Precio U.</th>
              <th>Desc.</th>
              <th>Base</th>
              <th>IVA %</th>
              <th>IVA valor</th>
              <th>Total linea</th>
              <th>Centro costo</th>
              <th>Modo</th>
              ${!readOnly ? `<th></th>` : ""}
            </tr>
          </thead>
          <tbody>
            ${(draft.lines || []).map(line => `
              <tr data-line-id="${esc(line.id)}" data-line-mode="inventory">
                <td class="purchase-cell-product">
                  <select name="inventoryItemId" ${readOnly ? "disabled" : ""}>
                    <option value="">Seleccionar producto</option>
                    ${inventoryItems.map(item => `<option value="${esc(item.id)}" ${line.inventoryItemId === item.id ? "selected" : ""}>${esc(item.code)} - ${esc(item.name)}</option>`).join("")}
                  </select>
                  <input type="hidden" name="accountCode" value="${esc(line.accountCode || "")}">
                  <input type="hidden" name="lineType" value="${esc(line.lineType || "inventario")}">
                  <input type="hidden" name="inventoryCategory" value="${esc(line.inventoryCategory || "")}">
                  <input type="hidden" name="inventoryUnit" value="${esc(line.inventoryUnit || "")}">
                  ${line.accountCode ? `<small class="line-hint">Cuenta auto: ${esc(line.accountCode)}${line.accountName ? ` - ${esc(line.accountName)}` : ""}</small>` : `<small class="line-hint">El producto debe tener cuenta de inventario parametrizada.</small>`}
                </td>
                <td><input class="readonly-cell-input" name="productCode" value="${esc(line.productCode || "")}" readonly></td>
                <td>
                  <input class="readonly-cell-input" name="description" value="${esc(line.description || "")}" readonly>
                  ${line.inventoryCategory ? `<small class="line-hint">${esc(purchaseService.inventoryCategoryLabel(line.inventoryCategory))}${line.inventoryUnit ? ` · ${esc(line.inventoryUnit)}` : ""}</small>` : ""}
                </td>
                <td><input name="quantity" type="number" step="0.01" min="0" value="${esc(String(line.quantity || 0))}" ${readOnly ? "disabled" : ""}></td>
                <td><input name="unitPrice" type="number" step="0.01" min="0" value="${esc(String(line.unitPrice || 0))}" ${readOnly ? "disabled" : ""}></td>
                <td><input name="discount" type="number" step="0.01" min="0" value="${esc(String(line.discount || 0))}" ${readOnly ? "disabled" : ""}></td>
                <td><input class="readonly-cell-input" name="taxableBase" type="number" step="0.01" min="0" value="${esc(String(line.taxableBase || 0))}" readonly></td>
                <td>${renderVatRate(line, draft, readOnly)}</td>
                <td><input class="readonly-cell-input" name="vatValue" type="number" step="0.01" min="0" value="${esc(String(line.vatValue || 0))}" readonly></td>
                <td><input class="readonly-cell-input" name="totalLine" type="number" step="0.01" min="0" value="${esc(String(line.totalLine || 0))}" readonly></td>
                <td><input name="costCenter" value="${esc(line.costCenter || "")}" ${readOnly ? "disabled" : ""}></td>
                <td>${lineModeBadge(line)}</td>
                ${!readOnly ? `<td><button class="row-action-button" type="button" data-manual-remove-line="${esc(line.id)}">Quitar</button></td>` : ""}
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderPurchaseLines(draft, readOnly) {
    return purchaseService.purchaseTypeUsesInventory(draft.purchaseType)
      ? renderInventoryPurchaseLines(draft, readOnly)
      : renderStandardPurchaseLines(draft, readOnly);
  }

  function renderManual(container, route) {
    if (!uiState.manual.draft) ensureManualDraft();
    const draft = uiState.manual.draft;
    const readOnly = uiState.manual.mode === "view" || !purchaseService.canEditPurchase(draft);
    const inventoryMode = purchaseService.purchaseTypeUsesInventory(draft.purchaseType);
    container.innerHTML = `
      <section class="page-header">
        <div>
          <p class="section-kicker">${esc(route.groupLabel.toUpperCase())}</p>
          <h1>${esc(route.title)}</h1>
          <p>${esc(route.description)}</p>
        </div>
        <div class="page-header-side">
          ${statusBadge(draft.status)}
        </div>
      </section>
      ${routeTabs(route)}
      ${uiState.manual.message ? `<section class="inline-feedback success">${esc(uiState.manual.message)}</section>` : ""}
      ${uiState.manual.errors.length ? `<section class="inline-feedback danger">${uiState.manual.errors.map(item => `<div>${esc(item)}</div>`).join("")}</section>` : ""}
      <section class="placeholder-grid purchase-editor-layout ${inventoryMode ? "purchase-editor-layout-wide" : ""}">
        <article class="panel-card">
          <div class="panel-card-head">
            <div>
              <p class="section-kicker">CABECERA</p>
              <h3>${draft.id ? `${readOnly ? "Visualizacion" : "Edicion"} de ${esc(draft.documentNumber)}` : "Nueva compra manual"}</h3>
            </div>
            <div class="editor-actions">
              <button class="secondary-button" type="button" data-purchase-clear>${draft.id ? "Nueva compra" : "Limpiar"}</button>
              <button class="secondary-button" type="button" data-route-link="purchases-invoices">Ir a bandeja</button>
              ${!readOnly ? `${uiState.manual.transientXmlReview ? "" : `<button class="secondary-button" type="button" data-purchase-save>Guardar borrador</button>`}<button class="secondary-button" type="button" data-purchase-post-editor>Contabilizar</button>` : ""}
            </div>
          </div>
          <form id="purchase-manual-form">
            ${renderManualHeaderFields(draft, readOnly)}
            ${renderPurchaseLines(draft, readOnly)}
          </form>
        </article>
        <article class="panel-card">
          <div class="panel-card-head">
            <div>
              <p class="section-kicker">RESUMEN</p>
              <h3>Totales y preparacion contable</h3>
            </div>
          </div>
          <div class="info-stack">
            <div class="info-row"><strong>Documento</strong><span>${esc(draft.documentNumber || "-")}</span></div>
            <div class="info-row"><strong>Base 0%</strong><span id="manual-total-base0">${money(draft.totals.base0)}</span></div>
            <div class="info-row"><strong>Base IVA</strong><span id="manual-total-baseiva">${money(draft.totals.baseIva)}</span></div>
            <div class="info-row"><strong>IVA</strong><span id="manual-total-iva">${money(draft.totals.iva)}</span></div>
            <div class="info-row"><strong>Total</strong><span id="manual-total-total">${money(draft.totals.total)}</span></div>
            <div class="info-row"><strong>Total retenciones</strong><span id="manual-total-withholdings">${money(draft.totals.withholdingsTotal)}</span></div>
            <div class="info-row"><strong>Saldo por pagar</strong><span id="manual-total-balance">${money(draft.totals.balanceDue)}</span></div>
            <div class="info-row"><strong>Cuenta por pagar</strong><span>${esc(draft.payableId ? "Preparada" : "Aun no generada")}</span></div>
            <div class="info-row"><strong>Asiento</strong><span>${esc(draft.journalEntryNumber || "Aun no contabilizado")}</span></div>
            <div class="info-row"><strong>Retencion</strong><span>${esc(draft.retentionStatus || "Pendiente")}</span></div>
            <div class="info-row"><strong>Decision tributaria</strong><span>${esc(draft.retentionDecision === "NO_SUJETO_332" ? "332 - No sujeto" : draft.retentionDecision === "APLICAR" ? "Aplicar retencion" : "Pendiente")}</span></div>
          </div>
          <p class="panel-note">La compra siempre acredita cuentas por pagar proveedores al contabilizar. Si el tipo afecta inventario, la cuenta del debito se toma automaticamente del producto parametrizado.</p>
        </article>
      </section>
    `;
    bindManual();
  }

  function renderXml(container, route) {
    container.innerHTML = `
      <section class="page-header">
        <div>
          <p class="section-kicker">${esc(route.groupLabel.toUpperCase())}</p>
          <h1>${esc(route.title)}</h1>
          <p>${esc(route.description)}</p>
        </div>
        <div class="page-header-side">
          <span class="status-badge pending">${uiState.xml.loading ? "Leyendo XML" : "Parser base local"}</span>
        </div>
      </section>
      ${routeTabs(route)}
      ${uiState.xml.message ? `<section class="inline-feedback success">${esc(uiState.xml.message)}</section>` : ""}
      ${uiState.xml.errors.length ? `<section class="inline-feedback danger">${uiState.xml.errors.map(item => `<div>${esc(item)}</div>`).join("")}</section>` : ""}
      <section class="placeholder-grid">
        <article class="panel-card">
          <div class="panel-card-head">
            <div>
              <p class="section-kicker">CARGA</p>
              <h3>Seleccionar archivos XML</h3>
            </div>
            <div class="editor-actions">
              <button class="secondary-button" type="button" data-xml-import ${uiState.xml.batch.some(item => ["VALIDO", "PENDIENTE_CUENTA"].includes(item.importStatus)) ? "" : "disabled"}>Revisar primer valido</button>
            </div>
          </div>
          <label class="compact-field full">
            <span>Archivos XML de compras</span>
            <input id="purchase-xml-input" type="file" accept=".xml,text/xml" multiple>
          </label>
          <p class="panel-note">El parser local intenta leer proveedor, fechas, serie, secuencial, autorizacion, bases, IVA, total y detalle. Los duplicados se comparan por RUC + tipo + serie + secuencial + autorizacion.</p>
        </article>
        <article class="panel-card">
          <div class="panel-card-head">
            <div>
              <p class="section-kicker">ESTADOS</p>
              <h3>Lectura e importacion</h3>
            </div>
          </div>
          <div class="module-chip-grid">
            ${purchaseService.importStatuses.map(status => `<span class="module-chip">${esc(status)}</span>`).join("")}
          </div>
        </article>
      </section>
      <article class="panel-card">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">REVISION</p>
            <h3>Documentos leidos antes de guardar</h3>
          </div>
          <span class="status-badge partial">${esc(String(uiState.xml.batch.length))} archivos</span>
        </div>
        <div class="compact-table-wrap">
          <table class="compact-table compact-table-xml-review">
            <thead>
              <tr>
                <th>Fecha de emision</th>
                <th>Proveedor</th>
                <th>Documento / N.º factura</th>
                <th>Estado importacion</th>
                <th>Estado compra</th>
                <th>Accion</th>
              </tr>
            </thead>
            <tbody>
              ${uiState.xml.batch.map((item, index) => item.purchase ? `
                <tr>
                  <td>${esc(item.purchase.issueDate || "-")}</td>
                  <td>
                    <strong>${esc(item.providerResolution?.legalName || item.purchase.supplierName)}</strong>
                    <small>RUC ${esc(item.purchase.supplierRuc || "-")} · ${item.providerResolution?.status === "REGISTERED" ? "Registrado" : "Se creará al contabilizar"}</small>
                  </td>
                  <td><strong>${esc(item.purchase.documentNumber)}</strong><small>${esc(purchaseService.voucherLabel(item.purchase.voucherType))}</small></td>
                  <td>${statusBadge(item.importStatus)}</td>
                  <td>${statusBadge(item.purchase.status)}</td>
                  <td>${["VALIDO", "PENDIENTE_CUENTA"].includes(item.importStatus) ? `<button class="row-action-button" type="button" data-xml-import-review="${index}">Importar y revisar</button>` : "-"}</td>
                </tr>
              ` : `
                <tr>
                  <td>-</td>
                  <td colspan="2">${esc(item.error || "No se pudo leer el archivo.")}</td>
                  <td>${statusBadge(item.importStatus || "ERROR_XML")}</td>
                  <td>${statusBadge("ERROR_XML")}</td>
                  <td>-</td>
                </tr>
              `).join("") || `<tr><td colspan="6"><div class="empty-inline">Todavia no se han seleccionado archivos XML.</div></td></tr>`}
            </tbody>
          </table>
        </div>
      </article>
    `;
    bindXml();
  }

  function filteredPendingRetentions() {
    return purchaseService.purchasesPendingRetention().filter(item => {
      return (!uiState.retentions.purchaseFilter || item.id === uiState.retentions.purchaseFilter);
    });
  }

  function round2(value) {
    return Number(Number(value || 0).toFixed(2));
  }

  function getRetentionPurchase(purchaseId) {
    return purchaseService.purchases().find(item => item.id === purchaseId) || null;
  }

  function isForeignPurchase(purchase) {
    return Boolean(purchase) && (
      purchase.voucherType === "documento_exterior"
      || String(purchase.purchaseType || "").toUpperCase() === "SERVICIOS_EXTERIOR"
    );
  }

  function applyForeignRetentionPreset(draft) {
    const current = clone(draft || purchaseService.emptyRetentionDraft());
    const purchase = getRetentionPurchase(current.purchaseId);
    if (!purchase) return current;
    current.retentionLines = [
      {
        ...purchaseService.emptyRetentionLine("RENTA", purchase),
        code: "520"
      },
      {
        ...purchaseService.emptyRetentionLine("IVA", purchase),
        code: "3"
      }
    ];
    return syncRetentionDraftDerivedValues(current, { forcePurchaseDefaults: true });
  }

  function syncRetentionDraftDerivedValues(draft, options = {}) {
    const { forcePurchaseDefaults = false } = options;
    const current = clone(draft || purchaseService.emptyRetentionDraft());
    const purchase = getRetentionPurchase(current.purchaseId);
    if (!Array.isArray(current.retentionLines)) current.retentionLines = [];
    if (purchase) {
      const rentBase = round2(Number(purchase.totals.base0 || 0) + Number(purchase.totals.baseIva || 0));
      const vatBase = round2(Number(purchase.totals.iva || 0));
      current.purchaseDocumentNumber = purchase.documentNumber;
      current.supplierName = purchase.supplierName;
      current.supplierRuc = purchase.supplierRuc;
      current.retentionLines.forEach(line => {
        const defaultBase = line.taxType === "IVA" ? vatBase : rentBase;
        if (forcePurchaseDefaults || !Number(line.baseAmount || 0)) line.baseAmount = defaultBase;
      });
    }
    if (!current.retentionDate) current.retentionDate = BlessERP.utils.today();
    current.retentionLines = current.retentionLines.map(line => {
      const normalized = {
        ...line,
        id: line.id || BlessERP.utils.uid("RTL"),
        taxType: String(line.taxType || "RENTA").toUpperCase() === "IVA" ? "IVA" : "RENTA",
        code: String(line.code || "")
      };
      const parameter = normalized.code ? purchaseService.withholdingByCode(normalized.code) : null;
      if (parameter && parameter.taxType && parameter.taxType !== normalized.taxType) normalized.code = "";
      if (normalized.code && parameter) {
        normalized.sriCode = parameter.sriCode || parameter.code || "";
        normalized.parameterId = parameter.id || "";
        normalized.description = parameter.description || "";
        normalized.percentage = Number(parameter.percentage || 0);
        normalized.payableAccountCode = parameter.payableAccountCode || normalized.payableAccountCode || "";
      } else {
        normalized.sriCode = "";
        normalized.parameterId = "";
        normalized.description = "";
        normalized.percentage = 0;
        normalized.payableAccountCode = "";
      }
      normalized.baseAmount = round2(normalized.baseAmount);
      normalized.percentage = round2(normalized.percentage);
      normalized.retainedAmount = round2(normalized.baseAmount * normalized.percentage / 100);
      return normalized;
    });
    const selectedLines = current.retentionLines.filter(line => line.code);
    const rentLines = selectedLines.filter(line => line.taxType === "RENTA");
    const vatLines = selectedLines.filter(line => line.taxType === "IVA");
    const firstRent = rentLines[0] || {};
    const firstVat = vatLines[0] || {};
    current.rentCode = firstRent.code || "";
    current.rentSriCode = firstRent.sriCode || "";
    current.rentDescription = firstRent.description || "";
    current.rentBaseAmount = round2(rentLines.reduce((sum, line) => sum + Number(line.baseAmount || 0), 0));
    current.rentPercentage = round2(firstRent.percentage || 0);
    current.rentRetainedAmount = round2(rentLines.reduce((sum, line) => sum + Number(line.retainedAmount || 0), 0));
    current.rentPayableAccountCode = firstRent.payableAccountCode || "";
    current.vatCode = firstVat.code || "";
    current.vatSriCode = firstVat.sriCode || "";
    current.vatDescription = firstVat.description || "";
    current.vatBaseAmount = round2(vatLines.reduce((sum, line) => sum + Number(line.baseAmount || 0), 0));
    current.vatPercentage = round2(firstVat.percentage || 0);
    current.vatRetainedAmount = round2(vatLines.reduce((sum, line) => sum + Number(line.retainedAmount || 0), 0));
    current.vatPayableAccountCode = firstVat.payableAccountCode || "";
    current.totalRetained = round2(selectedLines.reduce((sum, line) => sum + Number(line.retainedAmount || 0), 0));
    return current;
  }

  function retentionLineSummary(retention, taxType) {
    const lines = (retention.retentionLines || []).filter(line => line.taxType === taxType && line.code);
    if (!lines.length) return "-";
    return lines.map(line => `${esc(line.sriCode || line.code)} · ${money(line.retainedAmount)}`).join("<br>");
  }

  function filteredIssuedRetentions() {
    return purchaseService.issuedWithholdings().filter(item => {
      if (uiState.retentions.purchaseFilter && item.purchaseId !== uiState.retentions.purchaseFilter) return false;
      if (!uiState.retentions.typeFilter) return true;
      const hasRent = Number(item.rentRetainedAmount || 0) > 0;
      const hasVat = Number(item.vatRetainedAmount || 0) > 0;
      if (uiState.retentions.typeFilter === "MIXTA") return hasRent && hasVat;
      if (uiState.retentions.typeFilter === "RENTA") return hasRent;
      if (uiState.retentions.typeFilter === "IVA") return hasVat;
      return true;
    });
  }

  function retentionSummaryCards() {
    const summary = purchaseService.issuedWithholdingSummary();
    return `
      <section class="summary-grid summary-grid-purchases">
        <article class="summary-card"><span>Pendientes de retener</span><strong>${esc(String(filteredPendingRetentions().length))}</strong><small>Compras contabilizadas aun sin retencion</small></article>
        <article class="summary-card"><span>Borradores</span><strong>${esc(String(summary.drafts))}</strong><small>Editables antes de confirmar</small></article>
        <article class="summary-card"><span>Confirmadas</span><strong>${esc(String(summary.confirmed))}</strong><small>Ya afectan la cuenta por pagar</small></article>
        <article class="summary-card"><span>Renta por pagar</span><strong>${money(summary.totalRentPayable)}</strong><small>Saldo tributario preparado</small></article>
        <article class="summary-card"><span>IVA por pagar</span><strong>${money(summary.totalVatPayable)}</strong><small>Retencion IVA acumulada</small></article>
      </section>
    `;
  }

  function renderRetentions(container, route) {
    if (BlessERP.purchaseWithholdingV2Ui?.render?.(container, route)) return;
    const pending = filteredPendingRetentions();
    const drafts = filteredIssuedRetentions();
    const draftsPage = BlessERP.performance?.paginate?.(drafts, "purchases-issued-withholdings", { pageSize: 50 })
      || { items: drafts.slice(0, 50), total: drafts.length, pageSize: 50 };
    if (!uiState.retentions.draft) ensureRetentionDraft(pending[0]?.id || "");
    uiState.retentions.draft = syncRetentionDraftDerivedValues(uiState.retentions.draft);
    const draft = uiState.retentions.draft;
    const purchase = getRetentionPurchase(draft.purchaseId);
    const rentCodes = purchaseService.withholdingCatalog("RENTA", { issuableOnly: true });
    const vatCodes = purchaseService.withholdingCatalog("IVA", { issuableOnly: true });
    const editable = !draft.id || draft.status === "BORRADOR";
    const canProcess = !uiState.retentions.processing && !["AUTORIZADA", "ANULADA"].includes(draft.status);
    const processLabel = draft.journalEntryId ? "Reintentar autorizacion SRI" : "Confirmar y contabilizar";
    container.innerHTML = `
      <section class="page-header">
        <div>
          <p class="section-kicker">${esc(route.groupLabel.toUpperCase())}</p>
          <h1>${esc(route.title)}</h1>
          <p>${esc(route.description)}</p>
        </div>
        <div class="page-header-side">
          <span class="status-badge ${draft.status === "AUTORIZADA" ? "authorized" : "pending"}">${esc(draft.fullNumber || "Retencion sin secuencial")}</span>
        </div>
      </section>
      ${routeTabs(route)}
      ${uiState.retentions.message ? `<section class="inline-feedback success">${esc(uiState.retentions.message)}</section>` : ""}
      ${uiState.retentions.errors.length ? `<section class="inline-feedback danger">${uiState.retentions.errors.map(item => `<div>${esc(item)}</div>`).join("")}</section>` : ""}
      ${retentionSummaryCards()}
      <section class="panel-card compact-toolbar-card">
        <div class="compact-toolbar compact-toolbar-purchases">
          <label class="compact-inline-field">
            <span>Compra</span>
            <select id="retention-purchase-filter">
              <option value="">Todas</option>
              ${purchaseService.purchases().filter(item => isRetentionSelectable(item)).map(item => `<option value="${esc(item.id)}" ${uiState.retentions.purchaseFilter === item.id ? "selected" : ""}>${esc(item.documentNumber)} · ${esc(purchaseService.voucherLabel(item.voucherType))} · ${esc(item.supplierName)}</option>`).join("")}
            </select>
          </label>
          <label class="compact-inline-field">
            <span>Tipo</span>
            <select id="retention-type-filter">
              <option value="">Todas</option>
              <option value="RENTA" ${uiState.retentions.typeFilter === "RENTA" ? "selected" : ""}>Con renta</option>
              <option value="IVA" ${uiState.retentions.typeFilter === "IVA" ? "selected" : ""}>Con IVA</option>
              <option value="MIXTA" ${uiState.retentions.typeFilter === "MIXTA" ? "selected" : ""}>Mixtas</option>
            </select>
          </label>
          <div class="compact-toolbar-actions">
            <button class="secondary-button" type="button" data-retention-clear>Nueva retencion</button>
          </div>
        </div>
      </section>
      <section class="retention-disclosure-grid retention-disclosure-grid-single" aria-label="Seguimiento de retenciones">
        <button class="retention-disclosure-button ${uiState.retentions.trackingOpen ? "is-open" : ""}" type="button" data-retention-toggle-tracking aria-expanded="${uiState.retentions.trackingOpen}">
          <span><small>SEGUIMIENTO</small><strong>Retenciones emitidas registradas</strong><em>${drafts.length} registro(s)</em></span>
          <b>${uiState.retentions.trackingOpen ? "Ocultar" : "Desplegar"} ▾</b>
        </button>
      </section>
      <section class="retention-emission-stack">
        ${pending.length ? `<article class="panel-card">
          <div class="panel-card-head">
            <div>
              <p class="section-kicker">PENDIENTES</p>
              <h3>Compras listas para retencion</h3>
            </div>
            <span class="status-badge partial">${esc(String(pending.length))} compras</span>
          </div>
          <div class="compact-table-wrap">
            <table class="compact-table">
              <thead><tr><th>Documento</th><th>Proveedor</th><th>Base</th><th>IVA</th><th>Total</th><th>Estado</th><th></th></tr></thead>
              <tbody>
                ${pending.map(item => `
                  <tr>
                    <td><strong>${esc(item.documentNumber)}</strong><small>${esc(item.issueDate)}</small></td>
                    <td>${esc(item.supplierName)}</td>
                    <td>${money(Number(item.totals.base0 || 0) + Number(item.totals.baseIva || 0))}</td>
                    <td>${money(item.totals.iva)}</td>
                    <td>${money(item.totals.total)}</td>
                    <td>${statusBadge(item.status)}</td>
                    <td><button class="row-action-button" type="button" data-retention-from-purchase="${esc(item.id)}">Crear borrador</button></td>
                  </tr>
                `).join("") || `<tr><td colspan="7"><div class="empty-inline">No hay compras pendientes de retencion.</div></td></tr>`}
              </tbody>
            </table>
          </div>
        </article>` : ""}
        <article class="panel-card">
          <div class="panel-card-head">
            <div>
              <p class="section-kicker">EMISION</p>
              <h3>${draft.fullNumber ? `Retencion ${esc(draft.fullNumber)}` : "Nueva retencion emitida"}</h3>
            </div>
            <div class="editor-actions">
              <button class="primary-button" type="button" data-retention-confirm ${canProcess ? "" : "disabled"}>${uiState.retentions.processing ? "Procesando..." : processLabel}</button>
              <button class="secondary-button" type="button" data-retention-open-status>Estado de retencion</button>
            </div>
          </div>
          <form id="retention-draft-form" class="compact-form-grid">
            <label class="compact-field">
              <span>Compra relacionada</span>
              <select name="purchaseId" ${editable ? "" : "disabled"}>
                <option value="">Seleccionar compra</option>
                ${purchaseService.purchases().filter(item => isRetentionSelectable(item)).map(item => `<option value="${esc(item.id)}" ${draft.purchaseId === item.id ? "selected" : ""}>${esc(item.documentNumber)} · ${esc(purchaseService.voucherLabel(item.voucherType))} · ${esc(item.supplierName)}</option>`).join("")}
              </select>
            </label>
            <label class="compact-field"><span>Proveedor</span><input name="supplierName" value="${esc(draft.supplierName || "")}" readonly></label>
            <label class="compact-field"><span>RUC</span><input name="supplierRuc" value="${esc(draft.supplierRuc || "")}" readonly></label>
            <label class="compact-field"><span>Fecha retencion</span><input name="retentionDate" type="date" value="${esc(draft.retentionDate || "")}" ${editable ? "" : "disabled"}></label>
            <div class="helper-pill full">Documento: ${esc(purchase ? purchaseService.voucherLabel(purchase.voucherType) : "-")} · Fecha de compra: ${esc(purchase?.issueDate || "-")} · La retencion nueva toma la fecha del dia en que se elabora: ${esc(draft.retentionDate || "-")}.</div>
            ${isForeignPurchase(purchase) ? `
              <div class="helper-pill full">
                Documento del exterior: puede cargar el tratamiento rapido de Renta 25% e IVA 100%. La Renta se inicia con el codigo SRI 520 y puede cambiarse por 501, 502 o 511 segun la naturaleza real del pago. El IVA 100% se calcula sobre el valor de IVA registrado en la compra.
              </div>
              <div class="editor-actions full">
                <button class="secondary-button" type="button" data-retention-apply-exterior ${editable ? "" : "disabled"}>Aplicar exterior: IVA 100% + Renta 25%</button>
              </div>
            ` : ""}
            <label class="compact-field"><span>Numero de retencion</span><input name="fullNumber" value="${esc(draft.fullNumber || "")}" placeholder="Se asigna al confirmar y contabilizar" readonly></label>
            <label class="compact-field"><span>Estado</span><input name="status" value="${esc(draft.status || "BORRADOR")}" readonly></label>
            <div class="retention-lines-heading full">
              <div>
                <strong>Detalle de retenciones combinadas</strong>
                <small>Puede aplicar varias líneas de Renta o IVA sobre bases diferentes.</small>
              </div>
              <button class="secondary-button" type="button" data-retention-add-line ${editable ? "" : "disabled"}>+ Agregar línea</button>
            </div>
            <div class="compact-table-wrap full retention-lines-table">
              <table class="compact-table">
                <thead><tr><th>Impuesto</th><th>Código</th><th>Base imponible</th><th>%</th><th>Valor retenido</th><th>Cuenta</th><th></th></tr></thead>
                <tbody>
                  ${(draft.retentionLines || []).map(line => {
                    const catalog = line.taxType === "IVA" ? vatCodes : rentCodes;
                    return `
                      <tr data-retention-line="${esc(line.id)}">
                        <td>
                          <select data-retention-line-field="taxType" ${editable ? "" : "disabled"}>
                            <option value="RENTA" ${line.taxType === "RENTA" ? "selected" : ""}>Renta</option>
                            <option value="IVA" ${line.taxType === "IVA" ? "selected" : ""}>IVA</option>
                          </select>
                        </td>
                        <td>
                          <select data-retention-line-field="code" ${editable ? "" : "disabled"}>
                            <option value="">Seleccionar código</option>
                            ${catalog.map(item => `<option value="${esc(item.code)}" ${line.code === item.code ? "selected" : ""}>${esc(item.sriCode || item.code)} - ${esc(item.description)} (${esc(String(item.percentage))}%)</option>`).join("")}
                          </select>
                          <small>${esc(line.description || "Sin código seleccionado")}</small>
                        </td>
                        <td><input data-retention-line-field="baseAmount" type="number" step="0.01" min="0" value="${esc(String(line.baseAmount || 0))}" ${editable ? "" : "readonly"}></td>
                        <td><input data-retention-line-field="percentage" type="number" step="0.01" value="${esc(String(line.percentage || 0))}" readonly></td>
                        <td><input data-retention-line-field="retainedAmount" type="number" step="0.01" value="${esc(String(line.retainedAmount || 0))}" readonly></td>
                        <td><small>${esc(line.payableAccountCode || "-")}</small></td>
                        <td><button class="row-action-button danger" type="button" data-retention-remove-line="${esc(line.id)}" ${editable ? "" : "disabled"}>Quitar</button></td>
                      </tr>
                    `;
                  }).join("") || `<tr><td colspan="7"><div class="empty-inline">Agregue al menos una línea de retención.</div></td></tr>`}
                </tbody>
              </table>
            </div>
            <div class="retention-total-strip full">
              <span>${esc(String((draft.retentionLines || []).filter(line => line.code).length))} línea(s) aplicadas</span>
              <strong>Total retenido: ${money(draft.totalRetained || 0)}</strong>
              <small>Compra: ${esc(draft.purchaseDocumentNumber || purchase?.documentNumber || "-")} · Asiento: ${esc(draft.journalEntryNumber || "-")}</small>
            </div>
          </form>
          <p class="panel-note">El backend reserva primero el secuencial y la clave de acceso. Solamente despues se contabiliza y se procesa la autorizacion electronica, evitando asientos sin comprobante SRI.</p>
        </article>
      </section>
      ${uiState.retentions.statusOpen ? `
        <div class="erp-modal-backdrop" data-retention-status-backdrop>
          <section class="erp-modal-card retention-status-modal" role="dialog" aria-modal="true" aria-labelledby="retention-status-title">
            <div class="panel-card-head">
              <div><p class="section-kicker">ESTADO DE RETENCION</p><h3 id="retention-status-title">${esc(draft.fullNumber || "Sin secuencial asignado")}</h3></div>
              <button class="secondary-button" type="button" data-retention-close-status>Cerrar</button>
            </div>
            <div class="provider-history-body">
              <div class="compact-form-grid">
                <label class="compact-field"><span>Estado local</span><input value="${esc(draft.status || "BORRADOR")}" readonly></label>
                <label class="compact-field"><span>Estado SRI</span><input value="${esc(draft.sriRemoteStatus || (draft.status === "AUTORIZADA" ? "AUTORIZADO" : "PENDIENTE"))}" readonly></label>
                <label class="compact-field"><span>Numero de retencion</span><input value="${esc(draft.fullNumber || "Pendiente de asignacion")}" readonly></label>
                <label class="compact-field"><span>Ambiente</span><input value="${esc(draft.environment || "PRUEBAS")}" readonly></label>
                <label class="compact-field full"><span>Clave de acceso</span><input value="${esc(draft.accessKey || "Pendiente de generacion")}" readonly></label>
                <label class="compact-field full"><span>Numero de autorizacion</span><input value="${esc(draft.authorizationNumber || "Pendiente de respuesta SRI")}" readonly></label>
                <label class="compact-field"><span>Fecha de autorizacion</span><input value="${esc(String(draft.authorizedAt || "").replace("T", " ").slice(0, 19) || "-")}" readonly></label>
                <label class="compact-field full"><span>Ultimo mensaje</span><textarea rows="3" readonly>${esc(draft.sriLastError || (draft.status === "AUTORIZADA" ? "Retencion autorizada correctamente." : "La autorizacion aun no ha finalizado."))}</textarea></label>
              </div>
              <div class="editor-actions">
                <button class="secondary-button" type="button" data-retention-preview ${draft.id ? "" : "disabled"}>Vista previa RIDE</button>
                <button class="primary-button" type="button" data-retention-print ${draft.status === "AUTORIZADA" ? "" : "disabled"}>Imprimir RIDE</button>
                <button class="secondary-button" type="button" data-retention-download-xml ${draft.status === "AUTORIZADA" && draft.authorizedXml ? "" : "disabled"}>Descargar XML</button>
              </div>
            </div>
          </section>
        </div>
      ` : ""}
      <article class="panel-card" ${uiState.retentions.trackingOpen ? "" : "hidden"}>
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">SEGUIMIENTO</p>
            <h3>Retenciones emitidas registradas</h3>
          </div>
          <span class="status-badge partial">${esc(String(drafts.length))} registros</span>
        </div>
        <div class="compact-table-wrap">
          <table class="compact-table">
            <thead><tr><th>Fecha</th><th>Retencion</th><th>Compra</th><th>Proveedor</th><th>Renta</th><th>IVA</th><th>Total</th><th>Estado</th><th>Asiento</th><th></th></tr></thead>
            <tbody>
              ${draftsPage.items.map(item => `
                <tr>
                  <td>${esc(item.retentionDate)}</td>
                  <td><strong>${esc(item.fullNumber || item.draftNumber)}</strong><small>${item.authorizationNumber ? `Aut. ${esc(item.authorizationNumber)}` : esc(item.draftNumber)}</small></td>
                  <td>${esc(item.purchaseDocumentNumber || "-")}</td>
                  <td>${esc(item.supplierName)}</td>
                  <td>${retentionLineSummary(item, "RENTA")}</td>
                  <td>${retentionLineSummary(item, "IVA")}</td>
                  <td><strong>${money(item.totalRetained)}</strong></td>
                  <td>${statusBadge(item.status)}</td>
                  <td>${esc(item.journalEntryNumber || "-")}</td>
                  <td>
                    <div class="row-actions">
                      <button class="row-action-button" type="button" data-retention-load="${esc(item.id)}">Ver</button>
                      ${["BORRADOR", "CONFIRMADA", "LISTA_PARA_AUTORIZAR"].includes(item.status) ? `<button class="row-action-button" type="button" data-retention-row-process="${esc(item.id)}">${item.journalEntryId ? "Reintentar autorizacion SRI" : "Confirmar y contabilizar"}</button>` : ""}
                       ${item.status !== "BORRADOR" ? `<button class="row-action-button" type="button" data-retention-row-preview="${esc(item.id)}">RIDE</button>` : ""}
                       ${item.status === "AUTORIZADA" && item.authorizedXml ? `<button class="row-action-button" type="button" data-retention-row-xml="${esc(item.id)}">XML</button>` : ""}
                       ${item.status !== "ANULADA" ? `<button class="row-action-button" type="button" data-retention-annul="${esc(item.id)}">Anular</button>` : `<button class="row-action-button" type="button" data-retention-replace="${esc(item.id)}">Crear reemplazo</button>`}
                    </div>
                  </td>
                </tr>
              `).join("") || `<tr><td colspan="10"><div class="empty-inline">No hay retenciones emitidas registradas.</div></td></tr>`}
            </tbody>
          </table>
        </div>
        ${BlessERP.performance?.renderPager?.(draftsPage) || ""}
      </article>
    `;
    bindRetentions();
  }

  const retentionReportReadService = () => BlessERP.services.retentionReportReadV2;

  function workbookApi() {
    return BlessERP.operacionesRamosReportXlsx;
  }

  function totalBy(rows, key) {
    return round2((rows || []).reduce((sum, item) => sum + Number(item[key] || 0), 0));
  }

  function downloadWorkbook(workbook) {
    if (!workbook?.ok) return workbook || { ok: false, message: "No se pudo preparar el XLSX." };
    const blob = new Blob([workbook.archive], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = workbook.fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1200);
    return workbook;
  }

  function buildAccountedPurchasesWorkbook(rows) {
    const api = workbookApi();
    if (!api?.buildWorkbookArchive) {
      return { ok: false, message: "El generador XLSX de JAEDER SYSTEMS no esta disponible." };
    }
    const sheet = {
      name: "Compras contabilizadas",
      title: "BLESS FLOWER - COMPRAS CONTABILIZADAS",
      widths: [18, 16, 18, 34, 22, 15, 15, 15, 15, 15, 15, 15, 17, 17, 17, 17, 17],
      headers: [
        "Numero contable", "Fecha de emision", "RUC", "Proveedor", "Factura o documento",
        "Base 15%", "IVA 15%", "Base 8%", "IVA 8%", "Base 5%", "IVA 5%", "Base 0%",
        "Total compra", "Retencion IVA", "Retencion renta", "Total retenido", "Neto por pagar"
      ],
      rows: rows.map(item => [
        item.accountingNumber || "",
        item.issueDate || "",
        item.supplierRuc || "",
        item.supplierName || "",
        item.documentNumber || "",
        Number(item.base15 || 0),
        Number(item.iva15 || 0),
        Number(item.base8 || 0),
        Number(item.iva8 || 0),
        Number(item.base5 || 0),
        Number(item.iva5 || 0),
        Number(item.base0 || 0),
        Number(item.purchaseTotal || 0),
        Number(item.retentionVat || 0),
        Number(item.retentionRent || 0),
        Number(item.retentionTotal || 0),
        Number(item.netPayable || 0)
      ]),
      totals: [
        "TOTALES", "", "", "", "",
        totalBy(rows, "base15"), totalBy(rows, "iva15"),
        totalBy(rows, "base8"), totalBy(rows, "iva8"),
        totalBy(rows, "base5"), totalBy(rows, "iva5"), totalBy(rows, "base0"),
        totalBy(rows, "purchaseTotal"), totalBy(rows, "retentionVat"),
        totalBy(rows, "retentionRent"), totalBy(rows, "retentionTotal"), totalBy(rows, "netPayable")
      ]
    };
    const report = {
      period: `GENERADO ${BlessERP.utils.today()}`,
      range: `${rows.length} compra(s) contabilizada(s) · Valores tributarios y retenciones aplicadas`
    };
    return {
      ok: true,
      archive: api.buildWorkbookArchive([sheet], report),
      sheet,
      report,
      fileName: `compras-contabilizadas-${BlessERP.utils.today()}.xlsx`
    };
  }

  function buildRetentionDetailWorkbook(rows, period = "") {
    const api = workbookApi();
    if (!api?.buildWorkbookArchive) {
      return { ok: false, message: "El generador XLSX de JAEDER SYSTEMS no esta disponible." };
    }
    const sheet = {
      name: "Retenciones",
      title: "BLESS FLOWER - REPORTE DETALLADO DE RETENCIONES",
      widths: [18, 18, 34, 18, 22, 18, 15, 15, 18, 52],
      headers: [
        "Numero contable", "RUC", "Proveedor", "Numero de origen", "Numero de retencion",
        "Codigo de retencion", "Base", "Porcentaje", "Total de retencion", "Clave de acceso"
      ],
      rows: rows.map(item => [
        item.accountingNumber || "",
        item.supplierRuc || "",
        item.supplierName || "",
        item.originNumber || "",
        item.retentionNumber || "",
        item.retentionCode || "",
        Number(item.baseAmount || 0),
        Number(item.percentage || 0),
        Number(item.retainedAmount || 0),
        item.accessKey || ""
      ]),
      totals: ["TOTALES", "", "", "", "", "", totalBy(rows, "baseAmount"), "", totalBy(rows, "retainedAmount"), ""]
    };
    const report = {
      period: period ? `PERIODO ${period}` : `GENERADO ${BlessERP.utils.today()}`,
      range: `${rows.length} linea(s) de retencion · Una fila por codigo aplicado`
    };
    return {
      ok: true,
      archive: api.buildWorkbookArchive([sheet], report),
      sheet,
      report,
      fileName: `retenciones-detalladas-${period || BlessERP.utils.today()}.xlsx`
    };
  }

  function downloadAccountedPurchasesXlsx(purchaseIds = null) {
    const rows = Array.isArray(purchaseIds) && purchaseIds.length === 0
      ? []
      : purchaseService.accountedPurchaseReportRows(purchaseIds || []);
    return downloadWorkbook(buildAccountedPurchasesWorkbook(rows));
  }

  function downloadRetentionDetailXlsx(options = {}, period = "") {
    const explicitlyEmpty = Array.isArray(options.purchaseIds) && options.purchaseIds.length === 0
      || Array.isArray(options.retentionIds) && options.retentionIds.length === 0 && options.restrictToRetentionIds;
    const rows = explicitlyEmpty ? [] : purchaseService.retentionDetailReportRows(options);
    return downloadWorkbook(buildRetentionDetailWorkbook(rows, period));
  }

  function buildPurchaseHistoryWorkbook(rows, filters = {}) {
    const api = workbookApi();
    if (!api?.buildWorkbookArchive) return { ok: false, message: "El generador XLSX de JAEDER SYSTEMS no esta disponible." };
    const sheet = {
      name: "Facturas de compra", title: "BLESS FLOWER - FACTURAS DE COMPRA",
      widths: [14, 14, 18, 32, 22, 20, 18, 18, 18, 18, 18, 18],
      headers: ["Fecha emision", "Fecha contable", "RUC", "Proveedor", "Documento", "Tipo", "Subtotal", "IVA", "Total", "Estado", "Contabilizacion", "Retencion"],
      rows: rows.map(item => [item.issueDate || "", item.accountingDate || "", item.supplierRuc || "", item.supplierName || "", item.documentNumber || "",
        purchaseDocumentLabel(item.documentType), Number(item.subtotal || 0), Number(item.iva || 0), Number(item.total || 0), item.status || "", item.accountingStatus || "", item.retentionStatus || ""]),
      totals: ["TOTALES", "", "", "", "", "", totalBy(rows, "subtotal"), totalBy(rows, "iva"), totalBy(rows, "total"), "", "", ""]
    };
    const report = { period: `${filters.dateFrom || ""} a ${filters.dateTo || ""}`, range: `${rows.length} documento(s) · Mismos filtros aplicados en pantalla` };
    return { ok: true, archive: api.buildWorkbookArchive([sheet], report), sheet, report, fileName: `facturas-compra-${filters.dateFrom || "desde"}-${filters.dateTo || "hasta"}.xlsx` };
  }

  function buildRetentionReportWorkbook(rows) {
    const workbookApi = BlessERP.operacionesRamosReportXlsx;
    if (!workbookApi?.buildWorkbookArchive) {
      return { ok: false, message: "El generador XLSX de JAEDER SYSTEMS no esta disponible." };
    }
    const totals = key => round2(rows.reduce((sum, item) => sum + Number(item[key] || 0), 0));
    const sheet = {
      name: "Compras y retenciones",
      title: "BLESS FLOWER - REPORTE DE COMPRAS Y RETENCIONES",
      widths: [8, 16, 15, 16, 18, 34, 24, 20, 18, 15, 15, 15, 15, 15, 15, 15, 18, 15, 15, 16, 17, 22, 15, 15, 16, 13, 16, 16, 48],
      headers: [
        "Nro.",
        "Fecha compra",
        "Periodo compra",
        "Fecha contable",
        "RUC proveedor",
        "Proveedor",
        "Documento compra",
        "Sustento tributario",
        "Autorizacion",
        "Base IVA 15%",
        "IVA 15%",
        "Base IVA 8%",
        "IVA 8%",
        "Base IVA 5%",
        "IVA 5%",
        "Base 0%",
        "Base no objeto IVA",
        "Base exenta IVA",
        "Otras bases",
        "IVA otras tarifas",
        "IVA total",
        "Total compra",
        "Fecha retencion",
        "Periodo retencion",
        "Numero retencion",
        "Retencion renta",
        "Retencion IVA",
        "Total retenido",
        "Revision ATS"
      ],
      rows: rows.map((item, index) => [
        index + 1,
        item.purchaseDate || "",
        item.purchasePeriod || "",
        item.accountingDate || "",
        item.supplierRuc || "",
        item.supplierName || "",
        item.purchaseDocumentNumber || "",
        item.taxSupportCode || "",
        item.purchaseAuthorization || "",
        Number(item.base15 || 0),
        Number(item.iva15 || 0),
        Number(item.base8 || 0),
        Number(item.iva8 || 0),
        Number(item.base5 || 0),
        Number(item.iva5 || 0),
        Number(item.base0 || 0),
        Number(item.baseNoObjeto || 0),
        Number(item.baseExenta || 0),
        Number(item.baseOther || 0),
        Number(item.ivaOther || 0),
        Number(item.ivaTotal || 0),
        Number(item.purchaseTotal || 0),
        item.retentionDate || "",
        item.retentionPeriod || "",
        item.retentionNumber || "",
        Number(item.rentRetained || 0),
        Number(item.vatRetained || 0),
        Number(item.totalRetained || 0),
        item.atsTreatment || ""
      ]),
      totals: [
        "TOTALES", "", "", "", "", "", "", "", "",
        totals("base15"), totals("iva15"),
        totals("base8"), totals("iva8"),
        totals("base5"), totals("iva5"),
        totals("base0"), totals("baseNoObjeto"), totals("baseExenta"),
        totals("baseOther"), totals("ivaOther"), totals("ivaTotal"),
        totals("purchaseTotal"), "", "", "",
        totals("rentRetained"), totals("vatRetained"), totals("totalRetained"), ""
      ]
    };
    const report = {
      period: `PERIODO ${reportPeriod() || "SIN DEFINIR"}`,
      range: `${rows.length} registro(s) · Bases tributarias y retenciones relacionadas`
    };
    return {
      ok: true,
      archive: workbookApi.buildWorkbookArchive([sheet], report),
      sheet,
      report,
      fileName: `compras-retenciones-${reportPeriod() || "reporte"}.xlsx`
    };
  }

  function downloadRetentionReportXlsx(rows) {
    const workbook = buildRetentionReportWorkbook(rows);
    if (!workbook.ok) return workbook;
    const blob = new Blob([workbook.archive], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = workbook.fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1200);
    return workbook;
  }

  function renderRetentionReportLegacyDormant(container, route) {
    if (BlessERP.retentionReportV2Ui?.render?.(container, route)) return;
    container.innerHTML = `<section class="page-header"><div><p class="section-kicker">REPORTE TRIBUTARIO</p><h1>${esc(route.title)}</h1></div></section>
      <section class="inline-feedback error">Backend del reporte de retenciones pendiente de actualización.</section>`;
    return;
    const rows = retentionReportRows();
    const crossPeriod = rows.filter(item => item.crossPeriod).length;
    const outOfTerm = rows.filter(item => item.retentionOutOfTerm).length;
    const purchaseTotal = rows.reduce((sum, item) => sum + Number(item.purchaseTotal || 0), 0);
    const retentionTotal = rows.reduce((sum, item) => sum + Number(item.totalRetained || 0), 0);
    container.innerHTML = `
      <section class="page-header page-header-compact">
        <div>
          <p class="section-kicker">${esc(route.groupLabel.toUpperCase())}</p>
          <h1>${esc(route.title)}</h1>
          <p>${esc(route.description)}</p>
        </div>
        <div class="page-header-side">
          <span class="status-badge ${crossPeriod || outOfTerm ? "pending" : "authorized"}">${crossPeriod} cruce(s) · ${outOfTerm} fuera de plazo</span>
        </div>
      </section>
      ${routeTabs(route)}
      <section class="panel-card compact-toolbar-card">
        <div class="compact-toolbar purchase-retention-report-toolbar">
          <label class="compact-inline-field"><span>Periodo a revisar</span><input id="purchase-retention-period" type="month" value="${esc(reportPeriod())}"></label>
          <label class="compact-inline-field">
            <span>Mostrar por</span>
            <select id="purchase-retention-scope">
              <option value="BOTH" ${uiState.report.scope === "BOTH" ? "selected" : ""}>Compra o retencion del periodo</option>
              <option value="PURCHASE" ${uiState.report.scope === "PURCHASE" ? "selected" : ""}>Fecha de compra</option>
              <option value="RETENTION" ${uiState.report.scope === "RETENTION" ? "selected" : ""}>Fecha de retencion</option>
              <option value="CROSS" ${uiState.report.scope === "CROSS" ? "selected" : ""}>Solo periodos diferentes</option>
            </select>
          </label>
          <label class="compact-inline-field"><span>Buscar</span><input id="purchase-retention-search" placeholder="Proveedor, RUC o documento" value="${esc(uiState.report.search)}"></label>
          <div class="compact-toolbar-actions">
            <button class="secondary-button" type="button" data-purchase-retention-export>Resumen compras + retenciones XLSX</button>
            <button class="secondary-button" type="button" data-purchase-retention-detail-export>Retenciones detalladas XLSX</button>
          </div>
        </div>
      </section>
      <section class="summary-grid purchase-retention-report-summary">
        <article class="summary-card"><span>Filas del reporte</span><strong>${rows.length}</strong><small>Según periodo y alcance</small></article>
        <article class="summary-card"><span>Total compras</span><strong>${money(purchaseTotal)}</strong><small>Valores de las filas visibles</small></article>
        <article class="summary-card"><span>Total retenido</span><strong>${money(retentionTotal)}</strong><small>Renta e IVA</small></article>
        <article class="summary-card"><span>Periodos diferentes</span><strong>${crossPeriod}</strong><small>Requieren revision ATS</small></article>
        <article class="summary-card"><span>Fuera de plazo</span><strong>${outOfTerm}</strong><small>Mas de 5 dias desde la factura</small></article>
      </section>
      ${crossPeriod ? `<section class="inline-feedback warning">Existen compras y retenciones en meses diferentes. El reporte conserva ambas fechas: la compra no se traslada al mes de la retencion y el comprobante de retencion se revisa en su propio periodo.</section>` : ""}
      ${outOfTerm ? `<section class="inline-feedback error">Existen retenciones emitidas despues del plazo de 5 dias contado desde la fecha de la factura. Deben revisarse antes de preparar o presentar el ATS.</section>` : ""}
      <article class="panel-card">
        <div class="panel-card-head panel-card-head-compact">
          <div><p class="section-kicker">REPORTE</p><h3>Compras relacionadas con retenciones</h3></div>
          <span class="status-badge partial">${esc(reportPeriod())}</span>
        </div>
        <div class="compact-table-wrap">
          <table class="compact-table purchase-retention-report-table">
            <thead>
              <tr>
                <th>Fecha compra</th><th>Periodo compra</th><th>Proveedor</th><th>Documento</th><th>Total compra</th>
                <th>Fecha retencion</th><th>Periodo retencion</th><th>Dias</th><th>Retencion</th><th>Renta</th><th>IVA</th><th>Total retenido</th><th>Revision ATS</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map(item => `
                <tr class="${item.crossPeriod ? "report-cross-period-row" : ""}">
                  <td>${esc(item.purchaseDate || "-")}</td>
                  <td>${esc(item.purchasePeriod || "-")}</td>
                  <td><strong>${esc(item.supplierName || "-")}</strong><small>${esc(item.supplierRuc || "")}</small></td>
                  <td><strong>${esc(item.purchaseDocumentNumber || "-")}</strong><small>${statusBadge(item.purchaseStatus)}</small></td>
                  <td>${money(item.purchaseTotal)}</td>
                  <td>${esc(item.retentionDate || "-")}</td>
                  <td>${esc(item.retentionPeriod || "-")}</td>
                  <td><strong>${item.retentionDaysAfterPurchase ?? "-"}</strong></td>
                  <td><strong>${esc(item.retentionNumber || "-")}</strong><small>${statusBadge(item.retentionStatus)}</small></td>
                  <td>${money(item.rentRetained)}</td>
                  <td>${money(item.vatRetained)}</td>
                  <td><strong>${money(item.totalRetained)}</strong></td>
                  <td><span class="report-period-note ${item.crossPeriod ? "is-warning" : ""}">${esc(item.atsTreatment)}</span></td>
                </tr>
              `).join("") || `<tr><td colspan="13"><div class="empty-inline">No existen compras o retenciones para los filtros seleccionados.</div></td></tr>`}
            </tbody>
          </table>
        </div>
      </article>
    `;
    bindRetentionReportLegacyDormant(rows);
  }

  function bindRetentionReportLegacyDormant(rows) {
    document.querySelector("#purchase-retention-period")?.addEventListener("change", event => {
      uiState.report.period = event.target.value;
      BlessERP.layout.renderPage();
    });
    document.querySelector("#purchase-retention-scope")?.addEventListener("change", event => {
      uiState.report.scope = event.target.value;
      BlessERP.layout.renderPage();
    });
    document.querySelector("#purchase-retention-search")?.addEventListener("input", event => {
      uiState.report.search = event.target.value;
      BlessERP.layout.renderPage();
    });
    document.querySelector("[data-purchase-retention-export]")?.addEventListener("click", () => {
      const result = downloadRetentionReportXlsx(rows);
      if (!result.ok) BlessERP.layout.toast(result.message || "No se pudo generar el XLSX.");
    });
    document.querySelector("[data-purchase-retention-detail-export]")?.addEventListener("click", () => {
      const retentionIds = [...new Set(rows.map(item => item.retentionId).filter(Boolean))];
      const result = downloadRetentionDetailXlsx({ retentionIds, restrictToRetentionIds: true }, reportPeriod());
      if (!result.ok) BlessERP.layout.toast(result.message || "No se pudo generar el reporte detallado de retenciones.");
    });
  }

  // La declaración posterior sustituye el renderer histórico anterior. El componente
  // V2 es fail-closed y nunca vuelve a construir el reporte desde state.db.
  function renderRetentionReport(container, route) {
    if (BlessERP.retentionReportV2Ui?.render?.(container, route)) return;
    container.innerHTML = `<section class="page-header"><div><p class="section-kicker">REPORTE TRIBUTARIO</p><h1>${esc(route.title)}</h1></div></section>
      <section class="inline-feedback error">Backend del reporte de retenciones pendiente de actualización.</section>`;
  }

  function renderSupports(container, route) {
    const supports = purchaseService.taxSupports();
    const types = purchaseService.purchaseTypes();
    const withholdings = purchaseService.withholdingCatalog();
    container.innerHTML = `
      <section class="page-header">
        <div>
          <p class="section-kicker">${esc(route.groupLabel.toUpperCase())}</p>
          <h1>${esc(route.title)}</h1>
          <p>${esc(route.description)}</p>
        </div>
        <div class="page-header-side">
          <span class="status-badge authorized">Catalogos base disponibles</span>
        </div>
      </section>
      ${routeTabs(route)}
      <section class="placeholder-grid">
        <article class="panel-card">
          <div class="panel-card-head">
            <div><p class="section-kicker">SUSTENTOS</p><h3>Catalogo tributario base</h3></div>
            <span class="status-badge partial">${esc(String(supports.length))} codigos</span>
          </div>
          <div class="compact-table-wrap">
            <table class="compact-table">
              <thead><tr><th>Codigo</th><th>Descripcion</th><th>Estado</th><th>Cuenta sugerida</th><th>Tipo compra sugerido</th></tr></thead>
              <tbody>
                ${supports.map(item => `
                  <tr>
                    <td><strong>${esc(item.code)}</strong></td>
                    <td>${esc(item.description)}</td>
                    <td>${statusBadge(item.status)}</td>
                    <td>${esc(item.suggestedAccountCode || "-")}</td>
                    <td>${esc(item.suggestedPurchaseType || "-")}</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        </article>
        <article class="panel-card">
          <div class="panel-card-head">
            <div><p class="section-kicker">TIPOS</p><h3>Clasificacion de compra</h3></div>
            <span class="status-badge partial">${esc(String(types.length))} tipos</span>
          </div>
          <div class="compact-table-wrap">
            <table class="compact-table">
              <thead><tr><th>Codigo</th><th>Descripcion</th><th>Cuenta sugerida</th><th>Ret. fuente</th><th>Ret. IVA</th><th>Inventario</th><th>Centro costo</th></tr></thead>
              <tbody>
                ${types.map(item => `
                  <tr>
                    <td><strong>${esc(item.code)}</strong></td>
                    <td>${esc(item.label)}</td>
                    <td>${esc(item.suggestedAccountCode || "-")}</td>
                    <td>${item.requiresRetentionRent ? "Si" : "No"}</td>
                    <td>${item.requiresRetentionVat ? "Si" : "No"}</td>
                    <td>${item.affectsInventory ? "Si" : "No"}</td>
                    <td>${item.requiresCostCenter ? "Si" : "No"}</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        </article>
      </section>
      <article class="panel-card">
        <div class="panel-card-head">
          <div><p class="section-kicker">RETENCIONES</p><h3>Parametros base para renta e IVA</h3></div>
          <span class="status-badge partial">${esc(String(withholdings.length))} codigos</span>
        </div>
        <div class="compact-table-wrap">
          <table class="compact-table">
            <thead><tr><th>Codigo</th><th>Descripcion</th><th>Tipo impuesto</th><th>Porcentaje</th><th>Estado</th><th>Cuenta asociada</th></tr></thead>
            <tbody>
              ${withholdings.map(item => `
                <tr>
                  <td><strong>${esc(item.code)}</strong></td>
                  <td>${esc(item.description)}</td>
                  <td>${esc(item.taxType)}</td>
                  <td>${esc(String(item.percentage))}%</td>
                  <td>${statusBadge(item.status)}</td>
                  <td>${esc(item.payableAccountCode || "-")}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </article>
    `;
  }

  function collectManualDraft() {
    const form = document.querySelector("#purchase-manual-form");
    if (!form) return uiState.manual.draft;
    const base = clone(uiState.manual.draft || purchaseService.emptyPurchase());
    base.supplierId = form.elements.supplierId?.value || "";
    base.supplierRuc = form.elements.supplierRuc?.value || "";
    base.issueDate = form.elements.issueDate?.value || "";
    base.accountingDate = form.elements.accountingDate?.value || "";
    base.voucherType = form.elements.voucherType?.value || "";
    base.externalDocumentNumber = form.elements.externalDocumentNumber?.value || base.externalDocumentNumber || "";
    base.estab = form.elements.estab?.value || "";
    base.ptoEmi = form.elements.ptoEmi?.value || "";
    base.sequential = form.elements.sequential?.value || "";
    base.authorizationNumber = form.elements.authorizationNumber?.value || "";
    base.taxSupportCode = form.elements.taxSupportCode?.value || "";
    base.purchaseType = form.elements.purchaseType?.value || "";
    base.dueDate = form.elements.dueDate?.value || "";
    base.paymentMethod = form.elements.paymentMethod?.value || "";
    base.settlementMode = form.elements.settlementMode?.value || "CXP";
    base.paymentAccountCode = form.elements.paymentAccountCode?.value || "";
    base.payableAccountCode = form.elements.payableAccountCode?.value || "";
    base.vatCreditTreatment = form.elements.vatCreditTreatment?.value || base.vatCreditTreatment || "PENDING";
    base.retentionDecision = form.elements.retentionDecision?.value || "PENDIENTE";
    base.retentionDecisionReason = form.elements.retentionDecisionReason?.value || "";
    base.observation = form.elements.observation?.value || "";
    base.lines = Array.from(document.querySelectorAll(".compact-table-purchases-detail tbody tr[data-line-id]")).map(row => ({
      ...(base.lines.find(line => line.id === row.dataset.lineId) || {}),
      id: row.dataset.lineId,
      inventoryItemId: row.querySelector('[name="inventoryItemId"]')?.value || "",
      inventoryCategory: row.querySelector('[name="inventoryCategory"]')?.value || "",
      inventoryUnit: row.querySelector('[name="inventoryUnit"]')?.value || "",
      productCode: row.querySelector('[name="productCode"]')?.value || "",
      description: row.querySelector('[name="description"]')?.value || "",
      quantity: Number(row.querySelector('[name="quantity"]')?.value || 0),
      unitPrice: Number(row.querySelector('[name="unitPrice"]')?.value || 0),
      discount: Number(row.querySelector('[name="discount"]')?.value || 0),
      taxableBase: Number(row.querySelector('[name="taxableBase"]')?.value || 0),
      vatParameterId: row.querySelector('[name="vatParameterId"]')?.value ?? base.lines.find(line => line.id === row.dataset.lineId)?.vatParameterId ?? "",
      vatRate: Number(row.querySelector('[name="vatRate"]')?.value ?? base.lines.find(line => line.id === row.dataset.lineId)?.vatRate ?? 0),
      vatValue: Number(row.querySelector('[name="vatValue"]')?.value || 0),
      totalLine: Number(row.querySelector('[name="totalLine"]')?.value || 0),
      accountCode: row.querySelector('[name="accountCode"]')?.value || "",
      costCenter: row.querySelector('[name="costCenter"]')?.value || "",
      lineType: row.querySelector('[name="lineType"]')?.value || "gasto"
    }));
    return purchaseService.normalizePurchase(base);
  }

  function refreshManualSummary() {
    uiState.manual.draft = collectManualDraft();
    const totals = uiState.manual.draft.totals;
    document.querySelector("#manual-total-base0")?.replaceChildren(document.createTextNode(money(totals.base0)));
    document.querySelector("#manual-total-baseiva")?.replaceChildren(document.createTextNode(money(totals.baseIva)));
    document.querySelector("#manual-total-iva")?.replaceChildren(document.createTextNode(money(totals.iva)));
    document.querySelector("#manual-total-total")?.replaceChildren(document.createTextNode(money(totals.total)));
    document.querySelector("#manual-total-withholdings")?.replaceChildren(document.createTextNode(money(totals.withholdingsTotal)));
    document.querySelector("#manual-total-balance")?.replaceChildren(document.createTextNode(money(totals.balanceDue)));
  }

  function bindInvoices() {
    const service = purchaseReadService();
    const filters = uiState.invoices.draftFilters;
    const fieldMap = {
      "purchase-date-from": "dateFrom", "purchase-date-to": "dateTo", "purchase-date-kind": "dateKind", "purchase-search": "search",
      "purchase-status-filter": "status", "purchase-type-filter": "documentType", "purchase-supplier-filter": "supplierId",
      "purchase-posting-filter": "postingState", "purchase-retention-filter": "retentionStatus", "purchase-document-filter": "documentNumber"
    };
    Object.entries(fieldMap).forEach(([id, key]) => document.querySelector(`#${id}`)?.addEventListener("change", event => { filters[key] = event.target.value; }));
    document.querySelector("#purchase-search")?.addEventListener("input", event => { filters.search = event.target.value; });
    document.querySelector("#purchase-document-filter")?.addEventListener("input", event => { filters.documentNumber = event.target.value; });
    document.querySelector("#purchase-page-size")?.addEventListener("change", event => { uiState.invoices.pageSize = Number(event.target.value) || 25; });
    const runQuery = async page => {
      uiState.invoices.errors = [];
      if (!filters.dateFrom || !filters.dateTo) uiState.invoices.errors.push("Seleccione Desde y Hasta.");
      if (filters.dateFrom && filters.dateTo && filters.dateFrom > filters.dateTo) uiState.invoices.errors.push("Desde no puede ser posterior a Hasta.");
      if (uiState.invoices.errors.length) return BlessERP.layout.renderPage();
      try { await service?.queryHistory?.(clone(filters), { page, pageSize: uiState.invoices.pageSize }); }
      catch (error) { uiState.invoices.errors = [error.message || "No se pudo consultar las facturas."]; }
      BlessERP.layout.renderPage();
    };
    document.querySelector("[data-purchase-query]")?.addEventListener("click", () => void runQuery(1));
    document.querySelectorAll("[data-purchase-page]").forEach(button => button.addEventListener("click", () => void runQuery(Number(button.dataset.purchasePage))));
    document.querySelector("[data-purchase-new]")?.addEventListener("click", () => {
      ensureManualDraft();
      BlessERP.state.setRoute("purchases-manual");
      BlessERP.layout.renderApp();
    });
    document.querySelector("[data-purchases-export]")?.addEventListener("click", async event => {
      event.currentTarget.disabled = true;
      try {
        const result = await service?.exportAll?.(service.snapshot().history.appliedFilters);
        const workbook = buildPurchaseHistoryWorkbook(result.items, service.snapshot().history.appliedFilters);
        const downloaded = downloadWorkbook(workbook);
        if (!downloaded.ok) throw new Error(downloaded.message || "No se pudo generar el XLSX.");
      } catch (error) { BlessERP.layout.toast(error.message || "No se pudo exportar la consulta."); }
      finally { event.currentTarget.disabled = false; }
    });
    document.querySelectorAll("[data-purchase-view]").forEach(button => button.addEventListener("click", async () => {
      button.disabled = true;
      try { await service?.loadDetail?.(button.dataset.purchaseView, button.dataset.purchaseSource); }
      catch (error) { BlessERP.layout.toast(error.message || "No se pudo cargar el detalle."); }
    }));
    document.querySelectorAll("[data-purchase-edit]").forEach(button => button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        const detail = await service?.loadDetail?.(button.dataset.purchaseEdit, button.dataset.purchaseSource);
        ensureManualDraft(service.purchaseFromDetail(detail), "edit");
        BlessERP.state.setRoute("purchases-manual"); BlessERP.layout.renderApp();
      } catch (error) { BlessERP.layout.toast(error.message || "No se pudo cargar la compra."); }
    }));
    document.querySelectorAll("[data-purchase-post]").forEach(button => button.addEventListener("click", async () => {
      button.disabled = true;
      const result = await purchaseService.postPurchaseV2(button.dataset.purchasePost);
      if (result.ok) clearAccountedXmlReview(result.purchase);
      uiState.invoices.message = result.ok
        ? `Compra ${result.purchase.documentNumber} contabilizada y confirmada por Supabase${result.entry?.entryNumber ? ` con asiento ${result.entry.entryNumber}` : ""}.`
        : "";
      if (!result.ok) BlessERP.layout.toast((result.errors || ["No se pudo contabilizar la compra."]).join(" "));
      BlessERP.layout.renderPage();
    }));
    document.querySelectorAll("[data-purchase-retention]").forEach(button => button.addEventListener("click", () => {
      ensureRetentionDraft(button.dataset.purchaseRetention);
      BlessERP.state.setRoute("purchases-withholdings-issued");
      BlessERP.layout.renderApp();
    }));
    document.querySelectorAll("[data-purchase-delete]").forEach(button => button.addEventListener("click", async () => {
      let purchase;
      try { purchase = service.purchaseFromDetail(await service.loadDetail(button.dataset.purchaseDelete, button.dataset.purchaseSource)); }
      catch (error) { return BlessERP.layout.toast(error.message || "No se pudo cargar la compra."); }
      const action = purchaseService.canEditPurchase(purchase) ? "eliminar el borrador" : "anular la compra y reversar su asiento";
      if (!window.confirm(`Se va a ${action} ${purchase.documentNumber}. Desea continuar?`)) return;
      const reason = window.prompt("Motivo de la correccion:", "Correccion de registro") || "";
      if (!reason.trim()) return BlessERP.layout.toast("Ingrese un motivo para continuar.");
      button.disabled = true;
      const result = await purchaseService.deleteOrAnnulPurchaseV2(purchase.id, reason.trim());
      if (!result.ok) BlessERP.layout.toast((result.errors || [result.message || "No se pudo procesar la compra."]).join(" "));
      if (result.ok) await service.refresh().catch(() => {});
      BlessERP.layout.renderPage();
    }));
    document.querySelector("[data-purchase-detail-close]")?.addEventListener("click", () => service?.closeDetail?.());
    document.querySelector("[data-purchase-xml-load]")?.addEventListener("click", async event => {
      event.currentTarget.disabled = true;
      try { await service?.loadXml?.(event.currentTarget.dataset.purchaseXmlLoad, event.currentTarget.dataset.purchaseSource); }
      catch (error) { BlessERP.layout.toast(error.message || "No se pudo cargar el XML."); }
    });
  }

  function bindManual() {
    document.querySelector("[data-purchase-clear]")?.addEventListener("click", () => {
      ensureManualDraft();
      BlessERP.layout.renderPage();
    });
    document.querySelector("[data-manual-add-line]")?.addEventListener("click", () => {
      uiState.manual.draft = collectManualDraft();
      uiState.manual.draft.lines.push(purchaseService.emptyLine());
      BlessERP.layout.renderPage();
    });
    document.querySelectorAll("[data-manual-remove-line]").forEach(button => button.addEventListener("click", () => {
      uiState.manual.draft = collectManualDraft();
      uiState.manual.draft.lines = uiState.manual.draft.lines.filter(line => line.id !== button.dataset.manualRemoveLine);
      if (!uiState.manual.draft.lines.length) uiState.manual.draft.lines = [purchaseService.emptyLine()];
      BlessERP.layout.renderPage();
    }));
    document.querySelector("#purchase-manual-form")?.addEventListener("change", event => {
      if (["supplierId", "voucherType", "purchaseType", "inventoryItemId", "retentionDecision", "settlementMode", "issueDate", "taxSupportCode", "vatCreditTreatment", "payableAccountCode"].includes(event.target.name)) {
        uiState.manual.draft = collectManualDraft();
        if (event.target.name === "supplierId" && BlessERP.services.purchaseAccountContract?.enabled()) uiState.manual.draft.payableAccountCode = "";
        if (event.target.name === "purchaseType") {
          const config = purchaseService.purchaseTypeByCode(uiState.manual.draft.purchaseType);
          if (config?.suggestedSupportCode) uiState.manual.draft.taxSupportCode = config.suggestedSupportCode;
        }
        BlessERP.layout.renderPage();
        return;
      }
      uiState.manual.draft = collectManualDraft();
      if ((BlessERP.services.purchaseAccountContract?.enabled() || purchaseService.purchaseTypeUsesInventory(uiState.manual.draft.purchaseType)) && ["quantity", "unitPrice", "discount", "taxableBase", "vatRate", "vatParameterId"].includes(event.target.name)) {
        BlessERP.layout.renderPage();
        return;
      }
      refreshManualSummary();
    });
    document.querySelector("[data-purchase-save]")?.addEventListener("click", async event => {
      event.currentTarget.disabled = true;
      const result = await purchaseService.savePurchaseConfirmed(collectManualDraft());
      uiState.manual.errors = result.errors || [];
      uiState.manual.message = "";
      if (!result.ok) {
        BlessERP.layout.renderPage();
        return;
      }
      uiState.manual.draft = clone(result.purchase);
      uiState.manual.mode = "edit";
      uiState.manual.message = `Compra ${result.purchase.documentNumber} guardada en borrador.`;
      BlessERP.layout.renderPage();
    });
    document.querySelector("[data-purchase-post-editor]")?.addEventListener("click", async event => {
      event.currentTarget.disabled = true;
      const current = collectManualDraft();
      const result = await purchaseService.postPurchaseV2(current);
      uiState.manual.errors = result.errors || [];
      uiState.manual.message = "";
      if (!result.ok) {
        BlessERP.layout.renderPage();
        return;
      }
      clearAccountedXmlReview(result.purchase);
      ensureManualDraft(result.purchase, "view");
      const entryNumber = result.entry?.entryNumber || result.purchase.journalEntryNumber || "confirmado";
      uiState.manual.message = result.purchase.retentionDecision === "NO_SUJETO_332"
        ? `Compra contabilizada con asiento ${entryNumber}. Tratamiento 332 registrado para ATS.`
        : `Compra contabilizada con asiento ${entryNumber}. Queda pendiente de emitir la retencion.`;
      BlessERP.layout.renderPage();
    });
  }

  function bindXml() {
    document.querySelector("#purchase-xml-input")?.addEventListener("change", async event => {
      const files = Array.from(event.target.files || []);
      if (!files.length) return;
      uiState.xml.loading = true;
      uiState.xml.message = "Leyendo XML seleccionados...";
      uiState.xml.errors = [];
      BlessERP.layout.renderPage();
      try {
        uiState.xml.batch = await Promise.all(files.map(file => purchaseService.parseXmlFile(file)));
        const providerResolution = await purchaseService.resolveProvidersFromXmlBatchV2(uiState.xml.batch);
        uiState.xml.message = `Se leyeron ${uiState.xml.batch.length} archivos sin guardar. Proveedores: ${providerResolution.existing || 0} registrado(s), ${providerResolution.pendingCreation || 0} por crear al contabilizar. Duplicados del lote: ${providerResolution.duplicates || 0}.`;
        if (providerResolution.errors?.length) {
          uiState.xml.errors = providerResolution.errors.map(item => typeof item === "string" ? item : item.error || "No se pudo consultar un proveedor del XML.");
        }
      } catch (error) {
        uiState.xml.errors = [error?.message || "No se pudieron leer los XML seleccionados."];
      } finally {
        uiState.xml.loading = false;
        BlessERP.layout.renderPage();
      }
    });
    document.querySelector("[data-xml-import]")?.addEventListener("click", () => {
      const item = uiState.xml.batch.find(row => ["VALIDO", "PENDIENTE_CUENTA"].includes(row?.importStatus));
      if (!item?.purchase) return;
      ensureManualDraft(clone(item.purchase), "edit", { transientXmlReview: true });
      BlessERP.state.setRoute("purchases-manual");
      BlessERP.layout.renderApp();
    });
    document.querySelectorAll("[data-xml-import-review]").forEach(button => button.addEventListener("click", () => {
      const item = uiState.xml.batch[Number(button.dataset.xmlImportReview)];
      if (!item) return;
      ensureManualDraft(clone(item.purchase), "edit", { transientXmlReview: true });
      BlessERP.state.setRoute("purchases-manual");
      BlessERP.layout.renderApp();
    }));
  }

  function isRetentionSelectable(purchase) {
    const normalized = purchaseService.normalizePurchase(purchase);
    return normalized.retentionDecision === "APLICAR"
      && ["PENDIENTE_RETENCION", "CONTABILIZADO", "RETENIDO"].includes(normalized.status);
  }

  function collectRetentionDraft() {
    const form = document.querySelector("#retention-draft-form");
    if (!form) return uiState.retentions.draft;
    const draft = clone(uiState.retentions.draft || purchaseService.emptyRetentionDraft());
    draft.purchaseId = form.elements.purchaseId?.value || "";
    draft.supplierName = form.elements.supplierName?.value || "";
    draft.supplierRuc = form.elements.supplierRuc?.value || "";
    draft.retentionDate = form.elements.retentionDate?.value || "";
    draft.draftNumber = form.elements.draftNumber?.value || draft.draftNumber;
    draft.status = form.elements.status?.value || "BORRADOR";
    draft.retentionLines = Array.from(form.querySelectorAll("[data-retention-line]")).map(row => {
      const previous = (draft.retentionLines || []).find(line => line.id === row.dataset.retentionLine) || {};
      const field = name => row.querySelector(`[data-retention-line-field="${name}"]`);
      return {
        ...previous,
        id: row.dataset.retentionLine,
        taxType: field("taxType")?.value || "RENTA",
        code: field("code")?.value || "",
        baseAmount: Number(field("baseAmount")?.value || 0),
        percentage: Number(field("percentage")?.value || 0),
        retainedAmount: Number(field("retainedAmount")?.value || 0)
      };
    });
    draft.fullNumber = form.elements.fullNumber?.value || draft.fullNumber || "";
    draft.environment = form.elements.environment?.value || draft.environment || "PRUEBAS";
    draft.accessKey = form.elements.accessKey?.value || draft.accessKey || "";
    draft.authorizationNumber = form.elements.authorizationNumber?.value || "";
    draft.authorizedAt = form.elements.authorizedAt?.value || "";
    draft.authorizedXml = form.elements.authorizedXml?.value || "";
    return syncRetentionDraftDerivedValues(draft);
  }

  function retentionPurchase(retention) {
    return purchaseService.purchases().find(item => item.id === retention?.purchaseId) || null;
  }

  function openRetentionRide(retention, print = false) {
    if (!BlessERP.retentionRide?.open) {
      return { ok: false, message: "El generador del RIDE de retencion no esta cargado." };
    }
    return BlessERP.retentionRide.open(retention, retentionPurchase(retention), {
      print,
      note: retention.status === "AUTORIZADA"
        ? "Representacion impresa del comprobante electronico autorizado."
        : "Vista previa para revision. No constituye un comprobante autorizado por el SRI."
    });
  }

  function downloadRetentionXml(retention) {
    const xml = String(retention?.authorizedXml || "").trim();
    if (!xml || retention?.status !== "AUTORIZADA") {
      return { ok: false, message: "La retencion no tiene un XML autorizado almacenado." };
    }
    const url = URL.createObjectURL(new Blob([xml], { type: "application/xml;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `retencion-${String(retention.fullNumber || retention.draftNumber || "sri").replace(/[^0-9A-Za-z-]+/g, "-")}.xml`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    return { ok: true };
  }

  function digitsOnly(value) {
    return String(value || "").replace(/\D+/g, "");
  }

  function retentionSupportDocumentCode(purchase = {}) {
    return {
      factura: "01",
      liquidacion_compra: "03",
      nota_credito: "04",
      nota_debito: "05",
      documento_exterior: "01"
    }[purchase.voucherType] || "01";
  }

  function retentionSriPayload(retention, purchase) {
    if (!purchase) throw new Error("La compra relacionada no existe.");
    if (purchase.voucherType === "documento_exterior") {
      throw new Error("La autorizacion automatica del documento del exterior requiere configurar pais y regimen del pago antes de enviarlo al SRI.");
    }
    const identification = String(purchase.supplierRuc || "").trim();
    const identificationDigits = digitsOnly(identification);
    const identificationType = identificationDigits.length === 13 ? "04"
      : identificationDigits.length === 10 ? "05" : "06";
    const taxes = (purchase.lines || []).map(line => BlessERP.purchaseVatCore.supportingTax(line, purchase.issueDate)).filter(item => item.taxableBase > 0 || item.value > 0);
    const retentionLines = (retention.retentionLines || []).filter(line => line.code).map(line => ({
      code: line.taxType === "IVA" ? "2" : "1",
      retentionCode: String(line.sriCode || line.code || ""),
      taxableBase: Number(line.baseAmount || 0),
      rate: Number(line.percentage || 0),
      value: Number(line.retainedAmount || 0)
    }));
    const [year, month] = String(retention.retentionDate || "").split("-");
    return {
      buyer: {
        identificationType,
        identification: identificationDigits || identification,
        legalName: purchase.supplierName || retention.supplierName || "",
        address: purchase.supplierAddress || ""
      },
      withholding: {
        subject: {
          identificationType,
          identification: identificationDigits || identification,
          legalName: purchase.supplierName || retention.supplierName || "",
          address: purchase.supplierAddress || ""
        },
        relatedParty: false,
        fiscalPeriod: `${month || ""}/${year || ""}`,
        supportingDocuments: [{
          supportCode: purchase.taxSupportCode || "01",
          documentCode: retentionSupportDocumentCode(purchase),
          documentNumber: digitsOnly(purchase.documentNumber),
          issueDate: purchase.issueDate,
          accountingDate: purchase.accountingDate || purchase.issueDate,
          authorizationNumber: digitsOnly(purchase.authorizationNumber || purchase.accessKey),
          paymentLocation: "01",
          totalWithoutTax: Number(purchase.totals?.base0 || 0) + Number(purchase.totals?.baseIva || 0),
          grandTotal: Number(purchase.totals?.total || 0),
          taxes,
          retentions: retentionLines,
          payments: [{ method: purchase.paymentMethod || "20", total: Number(purchase.totals?.total || 0) }]
        }]
      },
      additionalInformation: BlessERP.softwareProvider?.mergeAdditionalInformation?.({}) || {}
    };
  }

  function nextSriRetentionAction(status) {
    const normalized = String(status || "BORRADOR").toUpperCase();
    if (["BORRADOR", "VALIDADO"].includes(normalized)) return "generate-xml";
    if (normalized === "XML_GENERADO") return "sign";
    if (["FIRMADO", "ENVIADO_SRI", "RECIBIDO_SRI", "ERROR_ENVIO", "PENDIENTE_REINTENTO"].includes(normalized)) return "transmit";
    return "";
  }

  async function ensureRetentionSriDraft(retention) {
    const api = BlessERP.sriApi;
    if (!api?.status?.().ready) {
      throw new Error("El servicio SRI de pruebas no esta disponible. La retencion permanece sin contabilizar y puede reintentarse desde este mismo boton.");
    }
    const purchase = retentionPurchase(retention);
    const configuration = await api.configuration();
    const sequence = BlessERP.services.adminConfig?.findSequenceByCode?.("RETE") || {};
    const retentionEstablishment = String(sequence.establishmentCode || "").trim();
    const retentionEmissionPoint = String(sequence.emissionPointCode || "").trim();
    if (!/^\d{3}$/.test(retentionEstablishment) || !/^\d{3}$/.test(retentionEmissionPoint)) {
      throw new Error("Configure el secuencial RETE con establecimiento y punto de emisión de 3 dígitos. No se usará silenciosamente otro punto SRI activo.");
    }
    const emissionPoint = (configuration.emissionPoints || []).find(point =>
      point.active !== false
      && String(point.environment || "TEST").toUpperCase() === "TEST"
      && String(point.establishment_code || "").padStart(3, "0") === retentionEstablishment
      && String(point.emission_point_code || "").padStart(3, "0") === retentionEmissionPoint
    );
    if (!emissionPoint?.id) {
      throw new Error(`No existe el punto de emisión RETE ${retentionEstablishment}-${retentionEmissionPoint} activo en ambiente TEST. Configure ese punto; no se utilizará el primer punto activo.`);
    }
    let detail = retention.sriRemoteDocumentId ? await api.detail(retention.sriRemoteDocumentId) : null;
    if (!detail) {
      detail = await api.post("create-draft", {
        documentType: "07",
        emissionPointId: emissionPoint.id,
        issueDate: retention.retentionDate,
        sourceOrderDate: purchase?.issueDate || retention.retentionDate,
        sourcePayload: retentionSriPayload(retention, purchase)
      });
      const synced = purchaseService.syncRemoteRetentionAuthorization(retention.id, detail);
      if (!synced.ok) throw new Error((synced.errors || ["No se pudo guardar el secuencial SRI de la retencion."]).join(" "));
      return { detail, retention: synced.retention };
    }
    return { detail, retention };
  }

  async function authorizeRetentionThroughSri(retention, initialDetail = null) {
    let detail = initialDetail;
    if (!detail) {
      const prepared = await ensureRetentionSriDraft(retention);
      detail = prepared.detail;
      retention = prepared.retention;
    }
    for (let stage = 0; stage < 4; stage += 1) {
      const document = detail.document || detail;
      const action = nextSriRetentionAction(document.status);
      if (!action) break;
      detail = await api.post(action, {
        documentId: document.id,
        // Este boton es una accion manual. Si el SRI dejo una consulta pendiente,
        // debe adelantar el reintento programado en lugar de fallar como NOT_DUE.
        ...(action === "transmit" ? { force: true } : {})
      });
      purchaseService.syncRemoteRetentionAuthorization(retention.id, detail);
      if (action === "transmit") break;
    }
    const synced = purchaseService.syncRemoteRetentionAuthorization(retention.id, detail);
    if (!synced.ok) throw new Error((synced.errors || ["No se pudo sincronizar la respuesta SRI."]).join(" "));
    if (synced.remoteStatus !== "AUTORIZADO") {
      const errors = (detail.errors || []).map(item => item.message || item.additional_information || "").filter(Boolean);
      throw new Error(errors.join(" ") || `El SRI dejo la retencion en estado ${synced.remoteStatus || "PENDIENTE"}.`);
    }
    return synced;
  }

  async function confirmAndAuthorizeRetention(initialDraft) {
    let draft = initialDraft;
    if (!draft.id || draft.status === "BORRADOR") {
      const saveResult = purchaseService.saveRetentionDraft(draft);
      if (!saveResult.ok) throw new Error((saveResult.errors || ["No se pudo guardar la retencion."]).join(" "));
      draft = saveResult.retention;
      uiState.retentions.draft = syncRetentionDraftDerivedValues(draft);
    }
    let sriDetail = null;
    if (!draft.sriRemoteDocumentId) {
      const prepared = await ensureRetentionSriDraft(draft);
      sriDetail = prepared.detail;
      draft = prepared.retention;
      uiState.retentions.draft = syncRetentionDraftDerivedValues(draft);
    }
    if (draft.status === "BORRADOR") {
      const confirmation = purchaseService.confirmRetentionDraft(draft.id);
      if (!confirmation.ok) throw new Error((confirmation.errors || ["No se pudo confirmar la retencion."]).join(" "));
      draft = confirmation.retention;
      uiState.retentions.draft = syncRetentionDraftDerivedValues(draft);
    }
    return authorizeRetentionThroughSri(draft, sriDetail);
  }

  async function runRetentionProcess(initialDraft) {
    if (uiState.retentions.processing) return;
    uiState.retentions.processing = true;
    uiState.retentions.errors = [];
    uiState.retentions.message = "";
    let draft = initialDraft;
    BlessERP.layout.renderPage();
    try {
      const authorization = await confirmAndAuthorizeRetention(draft);
      uiState.retentions.draft = syncRetentionDraftDerivedValues(authorization.retention);
      uiState.retentions.message = `Retencion ${authorization.retention.fullNumber} contabilizada y AUTORIZADA por el SRI.`;
      uiState.retentions.statusOpen = true;
    } catch (error) {
      const currentId = uiState.retentions.draft?.id || draft.id;
      const databaseMessage = String(error?.details?.databaseMessage || "").trim();
      const errorStage = String(error?.details?.stage || "").trim();
      const storedError = purchaseService.recordRetentionSriError?.(
        currentId,
        error?.message || "No se pudo completar la retencion.",
        { code: databaseMessage || error?.code, stage: errorStage }
      );
      const current = storedError?.retention || purchaseService.issuedWithholdings().find(item => item.id === currentId);
      if (current) uiState.retentions.draft = syncRetentionDraftDerivedValues(current);
      const errorCode = String(error?.code || "").trim();
      const diagnostic = [errorCode, databaseMessage, errorStage].filter(Boolean).join(" · ");
      uiState.retentions.errors = [
        `${error?.message || "No se pudo completar la retencion."}${diagnostic ? ` [${diagnostic}]` : ""}`
      ];
      uiState.retentions.statusOpen = Boolean(current?.journalEntryId || current?.sriRemoteDocumentId);
    } finally {
      uiState.retentions.processing = false;
      BlessERP.layout.renderPage();
    }
  }

  function bindRetentions() {
    document.querySelector("[data-retention-open-status]")?.addEventListener("click", () => {
      uiState.retentions.statusOpen = true;
      BlessERP.layout.renderPage();
    });
    document.querySelector("[data-retention-close-status]")?.addEventListener("click", () => {
      uiState.retentions.statusOpen = false;
      BlessERP.layout.renderPage();
    });
    document.querySelector("[data-retention-status-backdrop]")?.addEventListener("click", event => {
      if (event.target !== event.currentTarget) return;
      uiState.retentions.statusOpen = false;
      BlessERP.layout.renderPage();
    });
    document.querySelector("[data-retention-toggle-tracking]")?.addEventListener("click", () => {
      uiState.retentions.trackingOpen = !uiState.retentions.trackingOpen;
      BlessERP.layout.renderPage();
    });
    document.querySelectorAll("[data-retention-from-purchase]").forEach(button => button.addEventListener("click", () => {
      ensureRetentionDraft(button.dataset.retentionFromPurchase);
      BlessERP.layout.renderPage();
    }));
    document.querySelector("#retention-purchase-filter")?.addEventListener("change", event => {
      uiState.retentions.purchaseFilter = event.target.value;
      BlessERP.layout.renderPage();
    });
    document.querySelector("#retention-type-filter")?.addEventListener("change", event => {
      uiState.retentions.typeFilter = event.target.value;
      BlessERP.layout.renderPage();
    });
    document.querySelector("#retention-draft-form")?.addEventListener("change", event => {
      let draft = collectRetentionDraft();
      if (event.target.name === "purchaseId") {
        draft = syncRetentionDraftDerivedValues(draft, { forcePurchaseDefaults: true });
      }
      uiState.retentions.draft = draft;
      if (event.target.name === "purchaseId" || event.target.hasAttribute("data-retention-line-field")) {
        BlessERP.layout.renderPage();
      }
    });
    document.querySelector("[data-retention-add-line]")?.addEventListener("click", () => {
      const draft = collectRetentionDraft();
      const purchase = getRetentionPurchase(draft.purchaseId);
      draft.retentionLines = draft.retentionLines || [];
      draft.retentionLines.push(purchaseService.emptyRetentionLine("RENTA", purchase));
      uiState.retentions.draft = syncRetentionDraftDerivedValues(draft);
      BlessERP.layout.renderPage();
    });
    document.querySelector("[data-retention-apply-exterior]")?.addEventListener("click", () => {
      uiState.retentions.draft = applyForeignRetentionPreset(collectRetentionDraft());
      uiState.retentions.errors = [];
      uiState.retentions.message = "Se aplico el tratamiento inicial para documento del exterior. Revise el concepto de Renta y las bases antes de confirmar.";
      BlessERP.layout.renderPage();
    });
    document.querySelectorAll("[data-retention-remove-line]").forEach(button => button.addEventListener("click", () => {
      const draft = collectRetentionDraft();
      draft.retentionLines = (draft.retentionLines || []).filter(line => line.id !== button.dataset.retentionRemoveLine);
      uiState.retentions.draft = syncRetentionDraftDerivedValues(draft);
      BlessERP.layout.renderPage();
    }));
    document.querySelector("[data-retention-clear]")?.addEventListener("click", () => {
      ensureRetentionDraft(uiState.retentions.purchaseFilter || filteredPendingRetentions()[0]?.id || "");
      BlessERP.layout.renderPage();
    });
    document.querySelector("[data-retention-confirm]")?.addEventListener("click", () => runRetentionProcess(collectRetentionDraft()));
    document.querySelector("[data-retention-preview]")?.addEventListener("click", () => {
      const result = openRetentionRide(collectRetentionDraft(), false);
      if (!result.ok) {
        uiState.retentions.errors = [result.message || "No se pudo abrir el RIDE."];
        BlessERP.layout.renderPage();
      }
    });
    document.querySelector("[data-retention-print]")?.addEventListener("click", () => {
      const result = openRetentionRide(collectRetentionDraft(), true);
      if (!result.ok) {
        uiState.retentions.errors = [result.message || "No se pudo imprimir el RIDE."];
        BlessERP.layout.renderPage();
      }
    });
    document.querySelector("[data-retention-download-xml]")?.addEventListener("click", () => {
      const result = downloadRetentionXml(collectRetentionDraft());
      if (!result.ok) {
        uiState.retentions.errors = [result.message || "No se pudo descargar el XML."];
        BlessERP.layout.renderPage();
      }
    });
    document.querySelectorAll("[data-retention-load]").forEach(button => button.addEventListener("click", () => {
      const target = purchaseService.issuedWithholdings().find(item => item.id === button.dataset.retentionLoad);
      if (!target) return;
      uiState.retentions.errors = [];
      uiState.retentions.message = "";
      uiState.retentions.draft = syncRetentionDraftDerivedValues(target);
      BlessERP.layout.renderPage();
    }));
    document.querySelectorAll("[data-retention-row-process]").forEach(button => button.addEventListener("click", () => {
      const target = purchaseService.issuedWithholdings().find(item => item.id === button.dataset.retentionRowProcess);
      if (!target) return;
      uiState.retentions.draft = syncRetentionDraftDerivedValues(target);
      runRetentionProcess(clone(target));
    }));
    document.querySelectorAll("[data-retention-row-preview]").forEach(button => button.addEventListener("click", () => {
      const retention = purchaseService.issuedWithholdings().find(item => item.id === button.dataset.retentionRowPreview);
      const result = openRetentionRide(retention, false);
      if (!result.ok) {
        uiState.retentions.errors = [result.message || "No se pudo abrir el RIDE."];
        BlessERP.layout.renderPage();
      }
    }));
    document.querySelectorAll("[data-retention-row-xml]").forEach(button => button.addEventListener("click", () => {
      const retention = purchaseService.issuedWithholdings().find(item => item.id === button.dataset.retentionRowXml);
      const result = downloadRetentionXml(retention);
      if (!result.ok) {
        uiState.retentions.errors = [result.message || "No se pudo descargar el XML autorizado."];
        BlessERP.layout.renderPage();
      }
    }));
    document.querySelectorAll("[data-retention-annul]").forEach(button => button.addEventListener("click", () => {
      if (!window.confirm("La anulacion conservara el historial y reversara el asiento cuando corresponda. Desea continuar?")) return;
      const reason = window.prompt("Motivo obligatorio de anulacion:", "Correccion del comprobante") || "";
      if (!reason.trim()) return BlessERP.layout.toast("Debe indicar el motivo de anulacion.");
      const result = purchaseService.annulRetention(button.dataset.retentionAnnul, reason.trim());
      if (!result.ok) {
        uiState.retentions.errors = [result.message || "No se pudo anular la retencion."];
        uiState.retentions.message = "";
        return BlessERP.layout.renderPage();
      }
      uiState.retentions.errors = [];
      uiState.retentions.message = `Retencion ${result.retention.draftNumber} anulada.`;
      if (uiState.retentions.draft?.id === result.retention.id) {
        uiState.retentions.draft = syncRetentionDraftDerivedValues(result.retention);
      }
      BlessERP.layout.renderPage();
    }));
    document.querySelectorAll("[data-retention-replace]").forEach(button => button.addEventListener("click", () => {
      const result = purchaseService.replacementRetentionDraft(button.dataset.retentionReplace);
      if (!result.ok) {
        uiState.retentions.errors = result.errors || ["No se pudo crear el reemplazo."];
        return BlessERP.layout.renderPage();
      }
      uiState.retentions.errors = [];
      uiState.retentions.draft = syncRetentionDraftDerivedValues(result.retention);
      uiState.retentions.message = `Nuevo borrador de reemplazo creado desde ${result.retention.replacementOfNumber}. Al autorizar recibira un secuencial nuevo.`;
      BlessERP.layout.renderPage();
    }));
  }

  function settlementDateDefaults() {
    const today = BlessERP.utils.today();
    return { start: `${today.slice(0, 7)}-01`, end: today };
  }

  function ensureSettlementFilters() {
    const defaults = settlementDateDefaults();
    const state = uiState.settlements;
    const accounts = BlessERP.services.companySettings.settings().defaultAccounts || {};
    state.periodStart = state.periodStart || defaults.start;
    state.periodEnd = state.periodEnd || defaults.end;
    state.dueDate = state.dueDate || state.periodEnd;
    state.payableAccountCode = state.payableAccountCode || accounts.accountsPayableSuppliers || "";
    state.historyDraftFilters.dateFrom = state.historyDraftFilters.dateFrom || defaults.start;
    state.historyDraftFilters.dateTo = state.historyDraftFilters.dateTo || defaults.end;
  }

  function settlementCandidates() {
    return BlessERP.services.supplierSettlementReadV2?.snapshot?.().candidates?.items || [];
  }

  function renderSettlementDetail(detail) {
    if (!detail?.settlement) return "";
    const s = detail.settlement;
    const provider = s.provider || {};
    return `<section class="panel-card">
      <div class="panel-card-head"><div><p class="section-kicker">DETALLE LAZY</p><h3>${esc(s.settlement_code || s.settlementCode || s.settlement_id)}</h3></div><button class="secondary-button" type="button" data-settlement-detail-close>Cerrar</button></div>
      <div class="summary-grid"><article class="summary-card"><span>Proveedor</span><strong>${esc(provider.commercial_name || provider.legal_name || "-")}</strong><small>${esc(provider.tax_id || "")}</small></article>
        <article class="summary-card"><span>Bruto</span><strong>${money(s.gross_total || 0)}</strong><small>${esc(s.settlement_method || "")}</small></article>
        <article class="summary-card"><span>Descuento</span><strong>${money(s.discount_total || 0)}</strong><small>Ajuste ${money(s.adjustment_total || 0)}</small></article>
        <article class="summary-card"><span>Neto</span><strong>${money(s.total || 0)}</strong><small>${esc(s.status || "")}</small></article>
        <article class="summary-card"><span>CxP</span><strong>${esc(detail.payable?.status || "No vinculada")}</strong><small>${detail.payable?.balance != null ? money(detail.payable.balance) : ""}</small></article>
        <article class="summary-card"><span>Asiento</span><strong>${esc(detail.journal?.number || "No vinculado")}</strong><small>${esc(detail.journal?.status || "")}</small></article></div>
      <div class="compact-table-wrap"><table class="compact-table"><thead><tr><th>Recepcion</th><th>Fecha</th><th>Variedad</th><th>Medida</th><th>Cantidad</th><th>Precio</th><th>Descuento</th><th>Ajuste</th><th>Total</th></tr></thead><tbody>
        ${(detail.lines || []).map(line => `<tr><td>${esc(line.reception_id || "-")}</td><td>${esc(line.reception?.date || "-")}</td><td>${esc(line.variety || "-")}</td><td>${esc(line.length || "-")}</td><td>${esc(String(line.quantity || 0))} ${esc(line.quantity_type || "")}</td><td>${money(line.unit_price || 0)}</td><td>${money(line.discount || 0)}</td><td>${money(line.adjustment || 0)}</td><td>${money(line.total || 0)}</td></tr>`).join("") || `<tr><td colspan="9">Sin líneas.</td></tr>`}
      </tbody></table></div>
    </section>`;
  }

  function renderSupplierSettlements(container, route) {
    ensureSettlementFilters();
    const state = uiState.settlements;
    const providers = BlessERP.services.supplierFinanceV2?.providers?.() || [];
    const readService = BlessERP.services.supplierSettlementReadV2;
    readService?.setActiveRoute?.(route.id);
    const readState = readService?.snapshot?.() || { started: false, error: "", candidates: { loaded: false, loading: false, items: [], total: 0, summary: {} }, history: { loaded: false, loading: false, items: [], total: 0, page: 1, pageSize: 25, summary: {} }, detail: null };
    if (!readState.started) void readService?.start?.(() => BlessERP.layout.renderPage());
    const candidates = readState.candidates.items || [];
    const accounts = BlessERP.services.chartOfAccounts.movementOptions();
    const history = readState.history;
    const historyFilters = state.historyDraftFilters;
    const pageCount = Math.max(1, Math.ceil(Number(history.total || 0) / Number(history.pageSize || 25)));
    container.innerHTML = `
      <section class="page-header">
        <div><p class="section-kicker">COMPRAS / COSTO DE FLOR</p><h1>Liquidaciones de proveedores</h1>
          <p>Selecciona recepciones confirmadas. El servidor valida cantidades, registra el costo histórico y crea una sola cuenta por pagar.</p></div>
        <div class="page-header-side"><span class="status-badge authorized">Flujo V2 confirmado</span></div>
      </section>
      ${routeTabs(route)}
      ${state.message ? `<section class="inline-feedback success">${esc(state.message)}</section>` : ""}
      ${state.errors.length ? `<section class="inline-feedback danger">${state.errors.map(item => `<div>${esc(item)}</div>`).join("")}</section>` : ""}
      ${readState.error ? `<section class="inline-feedback error">${esc(readState.error)}</section>` : ""}
      <section class="panel-card compact-toolbar-card"><div class="compact-toolbar-actions">
        <button class="${state.view === "FORM" ? "primary-button" : "secondary-button"}" type="button" data-settlement-view="FORM">Preparar liquidacion</button>
        <button class="${state.view === "HISTORY" ? "primary-button" : "secondary-button"}" type="button" data-settlement-view="HISTORY">Historial</button>
      </div></section>
      ${state.view === "FORM" ? `<section class="panel-card">
        <div class="compact-form-grid">
          <label class="compact-field"><span>Proveedor / productor</span><select data-settlement-provider>
            <option value="">Seleccionar</option>${providers.filter(item => String(item.status || "").toLowerCase() !== "inactive").map(item => `<option value="${esc(item.id || item.providerId)}" ${state.providerId === String(item.id || item.providerId) ? "selected" : ""}>${esc(item.taxId || item.ruc)} · ${esc(item.name || item.legalName)}</option>`).join("")}
          </select></label>
          <label class="compact-field"><span>Desde</span><input type="date" data-settlement-start value="${esc(state.periodStart)}"></label>
          <label class="compact-field"><span>Hasta</span><input type="date" data-settlement-end value="${esc(state.periodEnd)}"></label>
          <label class="compact-field"><span>Vencimiento</span><input type="date" data-settlement-due value="${esc(state.dueDate)}"></label>
          <label class="compact-field"><span>Método</span><select data-settlement-method>
            <option value="PER_STEM" ${state.settlementMethod === "PER_STEM" ? "selected" : ""}>Precio por tallo</option>
            <option value="PER_BUNCH" ${state.settlementMethod === "PER_BUNCH" ? "selected" : ""}>Precio por ramo</option>
          </select></label>
          <label class="compact-field"><span>Cuenta costo / inventario</span><select data-settlement-cost-account><option value="">Seleccionar</option>${accounts.map(account => `<option value="${esc(account.code)}" ${state.costAccountCode === account.code ? "selected" : ""}>${esc(account.code)} · ${esc(account.name)}</option>`).join("")}</select></label>
          <label class="compact-field"><span>Cuenta por pagar</span><select data-settlement-payable-account><option value="">Seleccionar</option>${accounts.map(account => `<option value="${esc(account.code)}" ${state.payableAccountCode === account.code ? "selected" : ""}>${esc(account.code)} · ${esc(account.name)}</option>`).join("")}</select></label>
        </div>
        <div class="compact-toolbar-actions"><button class="primary-button" type="button" data-settlement-candidates-query ${readState.candidates.loading ? "disabled" : ""}>${readState.candidates.loading ? "Consultando…" : "Buscar flor por liquidar"}</button></div>
      </section>
      <section class="panel-card">
        <div class="panel-card-head"><div><p class="section-kicker">RECEPCIONES PENDIENTES</p><h3>Flor por liquidar</h3></div>
          ${readState.candidates.loaded ? `<span class="status-badge partial">${esc(String(readState.candidates.total))} item(s)</span><button class="primary-button" type="button" data-settlement-confirm>Confirmar y contabilizar</button>` : ""}</div>
        ${readState.candidates.summary?.truncated ? `<div class="inline-feedback danger">La consulta supera 500 ítems. Reduce el período antes de liquidar.</div>` : ""}
        <div class="compact-table-wrap"><table class="compact-table"><thead><tr><th></th><th>Fecha</th><th>Recepción</th><th>Variedad</th><th>Medida</th><th>Recibido</th><th>Liquidado</th><th>Pendiente</th><th>Precio</th></tr></thead><tbody>
          ${readState.candidates.loaded ? candidates.map(item => `<tr><td><input type="checkbox" data-settlement-line value="${esc(item.key)}"></td><td>${esc(item.date)}</td><td>${esc(item.receptionId)}</td><td>${esc(item.variety)}</td><td>${esc(item.length || "-")}</td><td>${esc(item.received)}</td><td>${esc(item.settled)}</td><td><strong>${esc(item.pending)}</strong></td><td><input class="table-input numeric-input" type="number" min="0" step="0.000001" data-settlement-price="${esc(item.key)}" value=""></td></tr>`).join("") || `<tr><td colspan="9"><div class="empty-inline">No existen ítems pendientes para el proveedor y período.</div></td></tr>` : `<tr><td colspan="9"><div class="empty-inline">Selecciona proveedor, período y pulsa Buscar flor por liquidar.</div></td></tr>`}
        </tbody></table></div>
      </section>` : `<section class="panel-card compact-toolbar-card"><div class="compact-toolbar">
        <label class="compact-inline-field"><span>Desde (fin período)</span><input type="date" data-settlement-history-from value="${esc(historyFilters.dateFrom)}"></label>
        <label class="compact-inline-field"><span>Hasta (fin período)</span><input type="date" data-settlement-history-to value="${esc(historyFilters.dateTo)}"></label>
        <label class="compact-inline-field"><span>Proveedor</span><select data-settlement-history-provider><option value="">Todos</option>${providers.filter(item => String(item.status || "").toLowerCase() !== "inactive").map(item => `<option value="${esc(item.id || item.providerId)}" ${historyFilters.providerId === String(item.id || item.providerId) ? "selected" : ""}>${esc(item.name || item.legalName)}</option>`).join("")}</select></label>
        <label class="compact-inline-field"><span>Estado</span><select data-settlement-history-status><option value="">Todos</option><option value="POSTED" ${historyFilters.status === "POSTED" ? "selected" : ""}>Contabilizada</option><option value="REVERSED" ${historyFilters.status === "REVERSED" ? "selected" : ""}>Reversada</option></select></label>
        <label class="compact-inline-field"><span>Número / referencia</span><input data-settlement-history-reference value="${esc(historyFilters.reference)}"></label>
        <label class="compact-inline-field"><span>Buscar</span><input data-settlement-history-search value="${esc(historyFilters.search)}"></label>
        <label class="compact-inline-field"><span>Filas</span><select data-settlement-history-size><option value="25" ${state.historyPageSize === 25 ? "selected" : ""}>25</option><option value="50" ${state.historyPageSize === 50 ? "selected" : ""}>50</option></select></label>
        <div class="compact-toolbar-actions"><button class="primary-button" type="button" data-settlement-history-query ${history.loading ? "disabled" : ""}>${history.loading ? "Consultando…" : "Consultar"}</button></div>
      </div></section>
      ${history.loaded ? `<section class="summary-grid"><article class="summary-card"><span>Liquidaciones</span><strong>${esc(String(history.summary?.settlements || 0))}</strong></article><article class="summary-card"><span>Bruto</span><strong>${money(history.summary?.grossTotal || 0)}</strong></article><article class="summary-card"><span>Descuentos</span><strong>${money(history.summary?.discountTotal || 0)}</strong></article><article class="summary-card"><span>Ajustes</span><strong>${money(history.summary?.adjustmentTotal || 0)}</strong></article><article class="summary-card"><span>Neto</span><strong>${money(history.summary?.netTotal || 0)}</strong></article></section>` : ""}
      <section class="panel-card"><div class="panel-card-head"><div><p class="section-kicker">HISTORIAL</p><h3>Liquidaciones de proveedores</h3></div><span class="status-badge partial">${history.loaded ? `${history.total} resultado(s)` : "0 historial cargado"}</span></div>
        <div class="compact-table-wrap"><table class="compact-table"><thead><tr><th>Número</th><th>Proveedor</th><th>Período</th><th>Método</th><th>Cantidad</th><th>Bruto</th><th>Descuento</th><th>Ajuste</th><th>Neto</th><th>Estado</th><th>Acción</th></tr></thead><tbody>
          ${history.loaded ? (history.items || []).map(item => `<tr><td><strong>${esc(item.settlementCode || item.id)}</strong></td><td>${esc(item.providerName || item.providerId)}</td><td>${esc(item.periodStart)} → ${esc(item.periodEnd)}</td><td>${esc(item.settlementMethod)}</td><td>${esc(String(item.totalQuantity || 0))}</td><td>${money(item.grossTotal || 0)}</td><td>${money(item.discountTotal || 0)}</td><td>${money(item.adjustmentTotal || 0)}</td><td>${money(item.total || 0)}</td><td>${statusBadge(item.status)}</td><td><button class="row-action-button" type="button" data-settlement-detail="${esc(item.id || item.settlementId)}">Ver</button>${String(item.status).toUpperCase() === "POSTED" ? `<button class="row-action-button" type="button" data-settlement-reverse="${esc(item.id || item.settlementId)}">Reversar</button>` : ""}</td></tr>`).join("") || `<tr><td colspan="11"><div class="empty-inline">No hay liquidaciones para los filtros aplicados.</div></td></tr>` : `<tr><td colspan="11"><div class="empty-inline">Selecciona filtros y pulsa Consultar.</div></td></tr>`}
        </tbody></table></div>
        ${history.loaded ? `<div class="pagination-bar"><span>Mostrando ${history.total ? (history.page-1)*history.pageSize+1 : 0}–${Math.min(history.page*history.pageSize,history.total)} de ${history.total} · Página ${history.page} de ${pageCount}</span><div><button class="secondary-button" type="button" data-settlement-history-page="${history.page-1}" ${history.page<=1?"disabled":""}>Anterior</button><button class="secondary-button" type="button" data-settlement-history-page="${history.page+1}" ${history.page>=pageCount?"disabled":""}>Siguiente</button></div></div>` : ""}
      </section>${renderSettlementDetail(readState.detail)}`}`;
    bindSupplierSettlements();
  }

  function bindSupplierSettlements() {
    const state = uiState.settlements;
    const readService = BlessERP.services.supplierSettlementReadV2;
    const updateCandidateFilter = (key, value) => { state[key] = value; state.message = ""; state.errors = []; readService?.clearCandidates?.(); };
    document.querySelectorAll("[data-settlement-view]").forEach(button => button.addEventListener("click", () => { state.view = button.dataset.settlementView; readService?.closeDetail?.(); BlessERP.layout.renderPage(); }));
    document.querySelector("[data-settlement-provider]")?.addEventListener("change", event => updateCandidateFilter("providerId", event.target.value));
    document.querySelector("[data-settlement-start]")?.addEventListener("change", event => updateCandidateFilter("periodStart", event.target.value));
    document.querySelector("[data-settlement-end]")?.addEventListener("change", event => { state.dueDate = event.target.value; updateCandidateFilter("periodEnd", event.target.value); });
    document.querySelector("[data-settlement-due]")?.addEventListener("change", event => { state.dueDate = event.target.value; });
    document.querySelector("[data-settlement-method]")?.addEventListener("change", event => updateCandidateFilter("settlementMethod", event.target.value));
    document.querySelector("[data-settlement-cost-account]")?.addEventListener("change", event => { state.costAccountCode = event.target.value; });
    document.querySelector("[data-settlement-payable-account]")?.addEventListener("change", event => { state.payableAccountCode = event.target.value; });
    document.querySelector("[data-settlement-candidates-query]")?.addEventListener("click", async () => {
      state.errors = [];
      if (!state.providerId) state.errors.push("Seleccione un proveedor.");
      if (!state.periodStart || !state.periodEnd || state.periodStart > state.periodEnd) state.errors.push("Seleccione un período válido.");
      if (state.errors.length) return BlessERP.layout.renderPage();
      try { await readService?.queryCandidates?.({ providerId: state.providerId, periodStart: state.periodStart, periodEnd: state.periodEnd, quantityType: state.settlementMethod === "PER_BUNCH" ? "BUNCH" : "STEM" }); }
      catch (error) { state.errors = [error.message || "No se pudo consultar la flor pendiente."]; }
      BlessERP.layout.renderPage();
    });
    document.querySelector("[data-settlement-confirm]")?.addEventListener("click", async event => {
      const provider = BlessERP.services.supplierFinanceV2?.providers?.().find(item => String(item.id || item.providerId) === state.providerId);
      const candidates = new Map(settlementCandidates().map(item => [item.key, item]));
      const lines = Array.from(document.querySelectorAll("[data-settlement-line]:checked")).map(input => {
        const item = candidates.get(input.value);
        const priceInput = Array.from(document.querySelectorAll("[data-settlement-price]"))
          .find(candidate => candidate.dataset.settlementPrice === input.value);
        const unitPrice = Number(priceInput?.value || 0);
        return item ? { ...item, quantity: item.pending, quantityType: item.quantityType, unitPrice,
          grossAmount: Number((item.pending * unitPrice).toFixed(6)), discount: 0, adjustment: 0,
          total: Number((item.pending * unitPrice).toFixed(6)), ruleSnapshot: { method: state.settlementMethod, unitPrice } } : null;
      }).filter(Boolean);
      const total = Number(lines.reduce((sum, item) => sum + item.total, 0).toFixed(6));
      const errors = [];
      if (!provider) errors.push("Seleccione un proveedor.");
      if (!lines.length) errors.push("Seleccione al menos una recepción.");
      if (lines.some(item => item.unitPrice <= 0)) errors.push("Cada recepción seleccionada debe tener precio mayor a cero.");
      if (!state.costAccountCode) errors.push("Seleccione la cuenta de costo o inventario.");
      if (!state.payableAccountCode) errors.push("Seleccione la cuenta por pagar.");
      if (errors.length) { state.errors = errors; return BlessERP.layout.renderPage(); }
      event.currentTarget.disabled = true;
      const result = await BlessERP.services.supplierFinanceV2.createSettlement({
        providerId: state.providerId, periodStart: state.periodStart, periodEnd: state.periodEnd, dueDate: state.dueDate,
        settlementMethod: state.settlementMethod, currencyCode: "USD", exchangeRate: 1, grossTotal: total,
        discountTotal: 0, adjustmentTotal: 0, total, payableAccountCode: state.payableAccountCode,
        ruleSnapshot: { method: state.settlementMethod, capturedAt: new Date().toISOString() }, lines,
        journal: { accountingDate: state.periodEnd, concept: `Liquidación ${provider.name || provider.legalName}`,
          originModule: "Compras", sourceDocument: "LIQUIDACION_PROVEEDOR", externalReference: "", currencyCode: "USD", exchangeRate: 1,
          observation: `Recepciones ${state.periodStart} a ${state.periodEnd}`,
          lines: [
            { accountCode: state.costAccountCode, debit: total, credit: 0, auxiliary: provider.taxId || provider.ruc || "", lineDescription: "Costo de flor recibida" },
            { accountCode: state.payableAccountCode, debit: 0, credit: total, auxiliary: provider.taxId || provider.ruc || "", lineDescription: "Cuenta por pagar proveedor" }
          ] }
      });
      state.errors = result.errors || [];
      state.message = result.ok ? `Liquidación ${result.settlement?.settlementCode || "confirmada"} registrada por Supabase.` : "";
      if (result.ok) { await readService?.refreshCandidates?.().catch(() => {}); await readService?.refreshHistory?.().catch(() => {}); }
      BlessERP.layout.renderPage();
    });
    document.querySelectorAll("[data-settlement-reverse]").forEach(button => button.addEventListener("click", async () => {
      const reason = window.prompt("Motivo de reversión de la liquidación:", "Corrección de liquidación") || "";
      if (!reason.trim()) return;
      button.disabled = true;
      const result = await BlessERP.services.supplierFinanceV2.reverseSettlement(button.dataset.settlementReverse, reason.trim());
      state.errors = result.errors || [];
      state.message = result.ok ? "Liquidación y obligación reversadas con trazabilidad." : "";
      if (result.ok) { await readService?.refreshCandidates?.().catch(() => {}); await readService?.refreshHistory?.().catch(() => {}); }
      BlessERP.layout.renderPage();
    }));
    const historyMap = { "settlement-history-from":"dateFrom","settlement-history-to":"dateTo","settlement-history-provider":"providerId","settlement-history-status":"status","settlement-history-reference":"reference","settlement-history-search":"search" };
    Object.entries(historyMap).forEach(([name,key]) => document.querySelector(`[data-${name}]`)?.addEventListener("change", event => { state.historyDraftFilters[key]=event.target.value; }));
    document.querySelector("[data-settlement-history-reference]")?.addEventListener("input", event => { state.historyDraftFilters.reference=event.target.value; });
    document.querySelector("[data-settlement-history-search]")?.addEventListener("input", event => { state.historyDraftFilters.search=event.target.value; });
    document.querySelector("[data-settlement-history-size]")?.addEventListener("change", event => { state.historyPageSize=Number(event.target.value)||25; });
    const queryHistory = async page => {
      state.errors=[]; const filters=clone(state.historyDraftFilters);
      if (!filters.dateFrom || !filters.dateTo || filters.dateFrom>filters.dateTo) state.errors.push("Seleccione un rango histórico válido.");
      if (state.errors.length) return BlessERP.layout.renderPage();
      try { await readService?.queryHistory?.(filters,{page,pageSize:state.historyPageSize}); }
      catch(error){ state.errors=[error.message||"No se pudo consultar el historial."]; }
      BlessERP.layout.renderPage();
    };
    document.querySelector("[data-settlement-history-query]")?.addEventListener("click",()=>void queryHistory(1));
    document.querySelectorAll("[data-settlement-history-page]").forEach(button=>button.addEventListener("click",()=>void queryHistory(Number(button.dataset.settlementHistoryPage))));
    document.querySelectorAll("[data-settlement-detail]").forEach(button=>button.addEventListener("click",async()=>{ button.disabled=true; try{await readService?.loadDetail?.(button.dataset.settlementDetail);}catch(error){BlessERP.layout.toast(error.message||"No se pudo cargar el detalle.");} }));
    document.querySelector("[data-settlement-detail-close]")?.addEventListener("click",()=>readService?.closeDetail?.());
  }

  function render(container, route) {
    if (route.id === "purchases-invoices") {
      renderInvoices(container, route);
      return;
    }
    if (route.id === "purchases-manual") {
      renderManual(container, route);
      return;
    }
    if (route.id === "purchases-supplier-settlements") {
      renderSupplierSettlements(container, route);
      return;
    }
    if (route.id === "purchases-upload-xml") {
      renderXml(container, route);
      return;
    }
    if (route.id === "purchases-providers") {
      BlessERP.modules.part2Portfolios.render(container, route, BlessERP.state.state);
      return;
    }
    if (route.id === "purchases-withholdings-issued") {
      renderRetentions(container, route);
      return;
    }
    if (route.id === "purchases-retention-report") {
      renderRetentionReport(container, route);
      return;
    }
    if (route.id === "purchases-tax-supports") {
      renderSupports(container, route);
    }
  }

  BlessERP.modules = BlessERP.modules || {};
  BlessERP.modules.part2Purchases = {
    render,
    ensureManualDraft,
    ensureRetentionDraft,
    buildRetentionReportWorkbook: (...args) => BlessERP.retentionReportV2Ui?.buildWorkbook?.(...args)
      || { ok: false, message: "El reporte V2 de retenciones no está disponible." },
    buildAccountedPurchasesWorkbook,
    buildRetentionDetailWorkbook
  };
})();
