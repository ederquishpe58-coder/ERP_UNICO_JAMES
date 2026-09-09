(function () {
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const today = new Date().toISOString().slice(0, 10);
  const view = {
    activeTab: "pending",
    draft: null,
    processing: false,
    message: "",
    error: "",
    detail: null,
    historyDraft: { dateFrom: `${today.slice(0, 7)}-01`, dateTo: today, provider: "", status: "", retentionNumber: "", purchaseNumber: "", search: "", pageSize: 25 }
  };
  const recoveryInFlight = new Set();
  const esc = value => BlessERP.utils?.escapeHtml?.(String(value ?? "")) || String(value ?? "");
  const money = value => Number(value || 0).toLocaleString("es-EC", { style: "currency", currency: "USD" });
  const clone = value => BlessERP.utils?.clone?.(value) || JSON.parse(JSON.stringify(value));
  const service = () => BlessERP.services?.purchaseWithholdingV2;

  function statusClass(status) {
    const value = String(status || "").toUpperCase();
    if (value === "AUTORIZADO") return "authorized";
    if (["DEVUELTO", "NO_AUTORIZADO", "ERROR_ENVIO"].includes(value)) return "cancelled";
    return "pending";
  }

  function statusLabel(status) { return String(status || "BORRADOR").replaceAll("_", " "); }

  function catalog(type) {
    return BlessERP.services?.purchases?.withholdingCatalog?.(type, { issuableOnly: true }) || [];
  }

  function selectedPurchase() { return service()?.purchaseById?.(view.draft?.purchaseId) || null; }

  function renderLine(line) {
    const options = catalog(line.taxType);
    return `<tr data-retention-v2-line="${esc(line.id)}">
      <td><select data-retention-v2-field="taxType"><option value="RENTA" ${line.taxType === "RENTA" ? "selected" : ""}>Renta</option><option value="IVA" ${line.taxType === "IVA" ? "selected" : ""}>IVA</option></select></td>
      <td><select data-retention-v2-field="code"><option value="">Seleccionar código</option>${options.map(item => `<option value="${esc(item.code)}" ${line.code === item.code ? "selected" : ""}>${esc(item.sriCode || item.code)} - ${esc(item.description)} (${esc(item.percentage)}%)</option>`).join("")}</select><small>${esc(line.description || "Sin código seleccionado")}</small></td>
      <td><input data-retention-v2-field="baseAmount" type="number" min="0" step="0.01" value="${esc(line.baseAmount)}"></td>
      <td><input data-retention-v2-field="percentage" type="number" step="0.01" value="${esc(line.percentage)}" readonly></td>
      <td><input data-retention-v2-field="retainedAmount" type="number" step="0.01" value="${esc(line.retainedAmount)}" readonly></td>
      <td><small>${esc(line.payableAccountCode || "-")}</small></td>
      <td><button class="row-action-button danger" type="button" data-retention-v2-remove="${esc(line.id)}">Quitar</button></td>
    </tr>`;
  }

  function draftFromForm() {
    const form = document.querySelector("#retention-v2-form");
    if (!form || !view.draft) return view.draft;
    const next = clone(view.draft);
    next.retentionDate = form.elements.retentionDate?.value || next.retentionDate;
    next.retentionLines = Array.from(form.querySelectorAll("[data-retention-v2-line]")).map(row => {
      const prior = next.retentionLines.find(line => line.id === row.dataset.retentionV2Line) || {};
      const field = name => row.querySelector(`[data-retention-v2-field="${name}"]`);
      const baseAmount = Number(field("baseAmount")?.value || 0);
      const percentage = Number(field("percentage")?.value || 0);
      return { ...prior, taxType: field("taxType")?.value || "RENTA", code: field("code")?.value || "", baseAmount, percentage, retainedAmount: Math.round((baseAmount * percentage / 100 + Number.EPSILON) * 100) / 100 };
    });
    return next;
  }

  function errorSummary(detail) {
    const error = detail?.errors?.[0] || {};
    const response = detail?.responses?.[0] || {};
    return {
      code: String(error.identifier || error.code || response.status_code || ""),
      message: String(error.message || response.message || detail?.document?.last_error || "Sin mensaje registrado"),
      additional: String(error.additional_information || ""),
      stage: String(error.stage || response.stage || "OTRA").replaceAll("_", " "),
      at: String(error.created_at || response.received_at || detail?.document?.updated_at || "")
    };
  }

  function detailModal() {
    if (!view.detail) return "";
    const document = view.detail.document || {};
    const diagnostic = errorSummary(view.detail);
    const policy = view.detail.recoveryPolicy || {};
    const purchase = view.detail.purchase || {};
    const journal = view.detail.journal || {};
    return `<div class="erp-modal-backdrop" data-retention-v2-detail-backdrop>
      <section class="erp-modal-card retention-status-modal" role="dialog" aria-modal="true">
        <div class="panel-card-head"><div><p class="section-kicker">RETENCIÓN SRI CANÓNICA</p><h3>${esc(document.full_number || "Sin número")}</h3></div><button class="secondary-button" type="button" data-retention-v2-detail-close>Cerrar</button></div>
        <div class="compact-form-grid">
          <label class="compact-field"><span>Estado SRI</span><input value="${esc(statusLabel(document.status))}" readonly></label>
          <label class="compact-field"><span>Factura origen</span><input value="${esc(purchase.documentNumber || "-")}" readonly></label>
          <label class="compact-field"><span>Proveedor</span><input value="${esc(purchase.supplierName || "-")}" readonly></label>
          <label class="compact-field"><span>Asiento V2</span><input value="${esc(journal.entry_number || "-")}" readonly></label>
          <label class="compact-field"><span>Etapa</span><input value="${esc(diagnostic.stage)}" readonly></label>
          <label class="compact-field"><span>Código</span><input value="${esc(diagnostic.code || "-")}" readonly></label>
          <label class="compact-field full"><span>Mensaje</span><textarea rows="2" readonly>${esc(diagnostic.message)}</textarea></label>
          <label class="compact-field full"><span>Información adicional</span><textarea rows="2" readonly>${esc(diagnostic.additional || "-")}</textarea></label>
          <label class="compact-field full"><span>Clave de acceso</span><input value="${esc(document.access_key || "-")}" readonly></label>
        </div>
        ${cancellationPanel(view.detail)}
        <div class="editor-actions">
          ${policy.action === "QUERY_AUTHORIZATION" ? `<button class="primary-button" type="button" data-retention-v2-recover="${esc(document.id)}" ${recoveryInFlight.has(document.id) ? "disabled" : ""}>${recoveryInFlight.has(document.id) ? "Consultando..." : esc(policy.actionLabel || "Consultar estado SRI")}</button>` : ""}
          <small>${esc(policy.reason || "")}</small>
        </div>
      </section>
    </div>`;
  }

  function cancellationPanel(detail) {
    const policy = detail.cancellation;
    if (!policy) return "";
    const actions = policy.actions || [];
    const labels = { DISCARD: "Descartar retención", REQUEST: "Solicitar anulación", SUBMIT_PORTAL_REFERENCE: "Registrar solicitud presentada en SRI", CONFIRM_OFFICIAL_ANNULMENT: "Registrar anulación oficial y revertir", REISSUE: "Volver a retener" };
    const editable = actions.some(action => action !== "REISSUE");
    return `<section class="panel-card">
      <h4>Corrección de retención</h4>
      ${policy.state !== "NONE" ? `<p>Trámite: <strong>${esc(policy.state.replaceAll("_", " "))}</strong></p>` : ""}
      ${["AUTORIZADO"].includes(detail.document?.status) ? `<p>La retención sigue vigente hasta que el SRI confirme su anulación. La solicitud y su aceptación se gestionan en <a href="https://srienlinea.sri.gob.ec/" target="_blank" rel="noopener noreferrer">SRI en Línea</a>. Este formulario registra el trámite y su evidencia.</p>` : ""}
      ${editable ? `<form id="retention-cancellation-form" class="compact-form-grid">
        <label class="compact-field full"><span>Motivo</span><textarea name="reason" minlength="3" maxlength="500" required>${esc(policy.workflow?.reason || "")}</textarea></label>
        ${actions.includes("SUBMIT_PORTAL_REFERENCE") || actions.includes("CONFIRM_OFFICIAL_ANNULMENT") ? `<label class="compact-field full"><span>Referencia del trámite / constancia oficial</span><input name="reference" minlength="3" maxlength="500" value="${esc(policy.workflow?.portal_reference || "")}" required></label>` : ""}
        ${actions.includes("CONFIRM_OFFICIAL_ANNULMENT") ? `<label class="compact-field"><span>Fecha de anulación oficial</span><input name="annulmentDate" type="date" required></label>
          <label class="compact-field"><span>Evidencia oficial (PDF, PNG o JPG, máximo 2 MB)</span><input name="evidenceFile" type="file" accept="application/pdf,image/png,image/jpeg" required></label>
          <label class="compact-field full"><span>Número de autorización que consta en la evidencia</span><input name="authorizationNumber" required></label>
          <label class="compact-field full"><span>Clave de acceso que consta en la evidencia</span><input name="accessKey" minlength="49" maxlength="49" required></label>
          <label class="full"><input name="verified" type="checkbox" required> Verifiqué en SRI en Línea que este comprobante consta ANULADO, no pendiente de anulación.</label>` : ""}
      </form>` : ""}
      <div class="editor-actions">${actions.map(action => `<button class="secondary-button" type="button" data-retention-cancellation="${esc(action)}" ${view.processing ? "disabled" : ""}>${esc(labels[action])}</button>`).join("")}
      ${policy.state === "PENDING_CANCELLATION" ? `<button class="secondary-button" type="button" data-retention-v2-view="${esc(policy.documentId)}">Consultar anulación registrada</button>` : ""}
      ${policy.workflow?.evidence_sha256 ? `<button class="secondary-button" type="button" data-retention-cancellation-evidence="${esc(policy.documentId)}">Ver evidencia oficial</button>` : ""}</div>
      ${(policy.history || []).length > 1 || ["DISCARDED", "ANULLED"].includes(policy.state) ? `<div class="compact-table-wrap"><table class="compact-table"><thead><tr><th>Retención</th><th>Estado fiscal</th><th>Trámite</th><th>Asiento de reversión</th></tr></thead><tbody>${(policy.history || []).map(row => `<tr><td><button type="button" class="row-action-button" data-retention-v2-view="${esc(row.documentId)}">${esc(row.fullNumber)}</button></td><td>${esc(row.status)}</td><td>${esc(row.cancellationState || "—")}</td><td>${esc(row.reversalJournalEntryId || "—")}</td></tr>`).join("")}</tbody></table></div>` : ""}
    </section>`;
  }

  async function evidenceBase64(file) {
    if (!file || file.size > 2097152 || !["application/pdf", "image/png", "image/jpeg"].includes(file.type)) throw new Error("Adjunte evidencia oficial PDF, PNG o JPG de máximo 2 MB.");
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1]);
      reader.onerror = () => reject(new Error("No se pudo leer la evidencia adjunta."));
      reader.readAsDataURL(file);
    });
  }

  function draftPanel() {
    const purchase = selectedPurchase();
    if (!view.draft || !purchase) return `<article class="panel-card"><div class="empty-inline">Seleccione una compra pendiente para preparar su retención.</div></article>`;
    const totalRetained = (view.draft.retentionLines || []).reduce((sum, line) => sum + Number(line.retainedAmount || 0), 0);
    return `<article class="panel-card">
      <div class="panel-card-head"><div><p class="section-kicker">EMISIÓN V2</p><h3>Nueva retención · ${esc(purchase.documentNumber)}</h3></div><button class="primary-button" type="button" data-retention-v2-create ${view.processing ? "disabled" : ""}>${view.processing ? "Creando..." : "Crear retención"}</button></div>
      <form id="retention-v2-form" class="compact-form-grid">
        <label class="compact-field"><span>Compra relacionada</span><input value="${esc(purchase.documentNumber)}" readonly></label>
        <label class="compact-field"><span>Proveedor</span><input value="${esc(purchase.supplierName)}" readonly></label>
        <label class="compact-field"><span>RUC</span><input value="${esc(purchase.supplierRuc)}" readonly></label>
        <label class="compact-field"><span>Fecha retención</span><input name="retentionDate" type="date" value="${esc(view.draft.retentionDate)}"></label>
        <div class="compact-table-wrap full retention-lines-table"><table class="compact-table"><thead><tr><th>Impuesto</th><th>Código</th><th>Base imponible</th><th>%</th><th>Valor retenido</th><th>Cuenta</th><th></th></tr></thead><tbody>${(view.draft.retentionLines || []).map(renderLine).join("")}</tbody></table></div>
        <div class="editor-actions full"><button class="secondary-button" type="button" data-retention-v2-add>+ Agregar línea</button></div>
        <div class="retention-total-strip full"><span>Base compra: ${money(purchase.subtotal)} · IVA: ${money(purchase.iva)} · Total: ${money(purchase.total)}</span><strong>Total retenido: ${money(totalRetained)}</strong><small>Las líneas se cargaron únicamente para esta compra. El secuencial se reserva en PostgreSQL al crear el documento.</small></div>
      </form>
    </article>`;
  }

  function rowActions(row) {
    return `<div class="row-actions">
      <button class="row-action-button" type="button" data-retention-v2-view="${esc(row.id)}">Ver detalle</button>
      ${service()?.nextAction?.(row.status) ? `<button class="row-action-button" type="button" data-retention-v2-process="${esc(row.id)}">Procesar SRI</button>` : ""}
      <button class="row-action-button" type="button" data-retention-v2-ride="${esc(row.id)}">RIDE</button>
      ${row.status === "AUTORIZADO" || (row.status === "ANULADO" && row.authorizationNumber) ? `<button class="row-action-button" type="button" data-retention-v2-xml="${esc(row.id)}">XML original</button>` : ""}
    </div>`;
  }

  function retentionRows(rows) {
    return rows.map(row => `<tr>
      <td>${esc(row.retentionDate || "-")}</td>
      <td><strong>${esc(row.fullNumber || "Sin número")}</strong></td>
      <td>${esc(row.supplierName)}<small>${esc(row.supplierRuc)}</small></td>
      <td>${esc(row.purchaseDocumentNumber)}</td>
      <td><strong>${money(row.totalRetained)}</strong></td>
      <td><span class="status-badge ${statusClass(row.status)}">${esc(statusLabel(row.status))}</span></td>
      <td>${esc(row.journalEntryNumber || "-")}</td>
      <td>${rowActions(row)}</td>
    </tr>`).join("");
  }

  function pager(kind, page, pageSize, total) {
    const pages = Math.max(1, Math.ceil(Number(total || 0) / Number(pageSize || 25)));
    if (pages <= 1) return "";
    return `<div class="editor-actions"><button class="secondary-button" type="button" data-retention-v2-${kind}-page="${page - 1}" ${page <= 1 ? "disabled" : ""}>Anterior</button><small>Página ${page} de ${pages} · ${total} registro(s)</small><button class="secondary-button" type="button" data-retention-v2-${kind}-page="${page + 1}" ${page >= pages ? "disabled" : ""}>Siguiente</button></div>`;
  }

  function pendingPanel(snapshot) {
    const queue = snapshot.queue || {};
    return `<section class="retention-emission-stack">
      <article class="panel-card">
        <div class="panel-card-head"><div><p class="section-kicker">COLA OPERATIVA</p><h3>Compras listas para retención</h3></div><span class="status-badge partial">${queue.total || 0} acción(es)</span></div>
        ${queue.loading && !queue.loaded ? `<div class="empty-inline">Consultando únicamente la cola operativa...</div>` : `<div class="compact-table-wrap"><table class="compact-table"><thead><tr><th>Documento proveedor</th><th>Proveedor</th><th>Base</th><th>IVA</th><th>Total</th><th>Estado</th><th></th></tr></thead><tbody>${snapshot.pending.map(row => `<tr><td><strong>${esc(row.documentNumber)}</strong><small>${esc(row.issueDate)}</small></td><td>${esc(row.supplierName)}</td><td>${money(row.subtotal)}</td><td>${money(row.iva)}</td><td><strong>${money(row.total)}</strong></td><td><span class="status-badge pending">PENDIENTE DE EMISIÓN</span></td><td><button class="row-action-button" type="button" data-retention-v2-from-purchase="${esc(row.id)}">Crear retención</button></td></tr>`).join("") || `<tr><td colspan="7"><div class="empty-inline">No hay compras V2 pendientes de emisión en esta página.</div></td></tr>`}</tbody></table></div>`}
      </article>
      ${snapshot.actionable.length ? `<article class="panel-card"><div class="panel-card-head"><div><p class="section-kicker">REQUIEREN ACCIÓN</p><h3>Retenciones por procesar</h3></div><span class="status-badge pending">${snapshot.actionable.length}</span></div><div class="compact-table-wrap"><table class="compact-table"><thead><tr><th>Fecha</th><th>Número</th><th>Proveedor</th><th>Factura origen</th><th>Total retenido</th><th>Estado SRI</th><th>Asiento</th><th></th></tr></thead><tbody>${retentionRows(snapshot.actionable)}</tbody></table></div></article>` : ""}
      ${pager("queue", queue.page || 1, queue.pageSize || 50, queue.total || 0)}
      ${draftPanel()}
    </section>`;
  }

  function historyFilters() {
    const filter = view.historyDraft;
    return `<form id="retention-v2-history-form" class="compact-form-grid">
      <label class="compact-field"><span>Desde</span><input name="dateFrom" type="date" value="${esc(filter.dateFrom)}"></label>
      <label class="compact-field"><span>Hasta</span><input name="dateTo" type="date" value="${esc(filter.dateTo)}"></label>
      <label class="compact-field"><span>Proveedor</span><input name="provider" value="${esc(filter.provider)}" placeholder="Nombre o RUC"></label>
      <label class="compact-field"><span>Estado SRI</span><select name="status"><option value="">Todos</option>${["BORRADOR", "VALIDADO", "XML_GENERADO", "FIRMADO", "ENVIADO_SRI", "RECIBIDO_SRI", "AUTORIZADO", "DEVUELTO", "NO_AUTORIZADO", "ERROR_ENVIO", "ANULADO"].map(status => `<option value="${status}" ${filter.status === status ? "selected" : ""}>${statusLabel(status)}</option>`).join("")}</select></label>
      <label class="compact-field"><span>Número retención</span><input name="retentionNumber" value="${esc(filter.retentionNumber)}" placeholder="001-002-000000000"></label>
      <label class="compact-field"><span>Factura de compra</span><input name="purchaseNumber" value="${esc(filter.purchaseNumber)}"></label>
      <label class="compact-field"><span>Buscar</span><input name="search" value="${esc(filter.search)}" placeholder="Clave, autorización, proveedor..."></label>
      <label class="compact-field"><span>Filas</span><select name="pageSize"><option value="25" ${Number(filter.pageSize) === 25 ? "selected" : ""}>25</option><option value="50" ${Number(filter.pageSize) === 50 ? "selected" : ""}>50</option></select></label>
      <div class="editor-actions full"><button class="primary-button" type="submit" ${view.processing ? "disabled" : ""}>${view.processing ? "Consultando..." : "Consultar"}</button></div>
    </form>`;
  }

  function historyPanel(snapshot) {
    const history = snapshot.history || {};
    return `<section class="retention-emission-stack">
      <article class="panel-card"><div class="panel-card-head"><div><p class="section-kicker">HISTORIAL SEARCH-FIRST</p><h3>Retenciones electrónicas tipo 07</h3></div>${history.loaded ? `<span class="status-badge partial">${history.total} registro(s)</span>` : ""}</div>${historyFilters()}</article>
      ${!history.loaded ? `<article class="panel-card"><div class="empty-inline">Selecciona filtros y pulsa Consultar. Abrir esta pestaña no descarga el historial.</div></article>` : `<article class="panel-card">${history.dirty ? `<div class="inline-feedback">Existen cambios canónicos posteriores. Pulsa Consultar para actualizar este historial.</div>` : ""}<div class="compact-table-wrap"><table class="compact-table"><thead><tr><th>Fecha</th><th>Número</th><th>Proveedor</th><th>Factura origen</th><th>Total retenido</th><th>Estado SRI</th><th>Asiento</th><th></th></tr></thead><tbody>${retentionRows(history.items) || `<tr><td colspan="8"><div class="empty-inline">No existen retenciones para los filtros aplicados.</div></td></tr>`}</tbody></table></div>${pager("history", history.page || 1, history.pageSize || 25, history.total || 0)}</article>`}
    </section>`;
  }

  function readHistoryFilters() {
    const form = document.querySelector("#retention-v2-history-form");
    if (!form) return clone(view.historyDraft);
    return {
      dateFrom: form.elements.dateFrom?.value || "",
      dateTo: form.elements.dateTo?.value || "",
      provider: form.elements.provider?.value?.trim() || "",
      status: form.elements.status?.value || "",
      retentionNumber: form.elements.retentionNumber?.value?.trim() || "",
      purchaseNumber: form.elements.purchaseNumber?.value?.trim() || "",
      search: form.elements.search?.value?.trim() || "",
      pageSize: Number(form.elements.pageSize?.value || 25)
    };
  }

  function findRetention(snapshot, id) {
    return [...(snapshot.actionable || []), ...(snapshot.history?.items || [])].find(row => row.id === id) || null;
  }

  function render(container, route) {
    const api = service();
    if (!api) return false;
    api.setHistoryVisible(view.activeTab === "history");
    api.start(() => BlessERP.state?.state?.route?.id === route.id && BlessERP.layout.renderPage());
    const snapshot = api.snapshot();
    if (view.draft?.purchaseId && !api.purchaseById(view.draft.purchaseId)) view.draft = null;
    container.innerHTML = `<section class="page-header"><div><p class="section-kicker">${esc(route.groupLabel?.toUpperCase() || "COMPRAS")}</p><h1>${esc(route.title)}</h1><p>Cola operativa acotada + historial bajo demanda. Compra V2 y documento electrónico 07 permanecen canónicos.</p></div><div class="page-header-side"><span class="status-badge authorized">RETENCIONES V2</span></div></section>
      ${view.message ? `<section class="inline-feedback success">${esc(view.message)}</section>` : ""}
      ${view.error || snapshot.error ? `<section class="inline-feedback danger">${esc(view.error || snapshot.error)}</section>` : ""}
      <section class="editor-actions"><button class="${view.activeTab === "pending" ? "primary-button" : "secondary-button"}" type="button" data-retention-v2-tab="pending">Pendientes <span>${snapshot.queue?.total || 0}</span></button><button class="${view.activeTab === "history" ? "primary-button" : "secondary-button"}" type="button" data-retention-v2-tab="history">Historial</button></section>
      ${view.activeTab === "history" ? historyPanel(snapshot) : pendingPanel(snapshot)}
      ${detailModal()}`;
    bind(snapshot);
    return true;
  }

  function bind(snapshot) {
    document.querySelectorAll("[data-retention-cancellation]").forEach(button => button.addEventListener("click", async () => {
      if (view.processing) return;
      const current = view.detail;
      const action = button.dataset.retentionCancellation;
      if (!current?.cancellation?.actions?.includes(action)) return;
      const form = document.querySelector("#retention-cancellation-form");
      if (action !== "REISSUE" && !form?.reportValidity()) return;
      const fields = form?.elements;
      const reason = fields?.reason?.value?.trim() || "";
      const evidence = { accessKey: current.document.access_key, reference: fields?.reference?.value?.trim() || "" };
      const file = fields?.evidenceFile?.files?.[0];
      if (action === "CONFIRM_OFFICIAL_ANNULMENT") Object.assign(evidence, {
        accessKey: fields.accessKey.value.trim(), authorizationNumber: fields.authorizationNumber.value.trim(),
        officialStatus: "ANULADO", verifiedInSriOnline: fields.verified.checked,
        annulmentDate: fields.annulmentDate.value, contentType: file?.type
      });
      view.processing = true; view.error = ""; view.message = ""; BlessERP.layout.renderPage();
      try {
        if (action === "REISSUE") {
          view.draft = await service().prepareDraft(current.cancellation.purchaseId);
          view.detail = null; view.activeTab = "pending";
        } else {
          if (action === "CONFIRM_OFFICIAL_ANNULMENT") evidence.fileBase64 = await evidenceBase64(file);
          view.detail = await service().cancelWithholding(current, action, reason, evidence);
          view.message = action === "REQUEST" ? "Trámite interno abierto. Presente la solicitud en SRI en Línea; la retención sigue vigente."
            : action === "SUBMIT_PORTAL_REFERENCE" ? "Solicitud registrada. La retención sigue vigente mientras el SRI no confirme su anulación."
            : "Retención conservada en historial, asiento revertido y compra disponible para volver a retener.";
        }
      } catch (error) { view.error = error.message; }
      finally { view.processing = false; BlessERP.layout.renderPage(); }
    }));
    document.querySelectorAll("[data-retention-cancellation-evidence]").forEach(button => button.addEventListener("click", async () => {
      try { await service().downloadCancellationEvidence(button.dataset.retentionCancellationEvidence); }
      catch (error) { view.error = error.message; BlessERP.layout.renderPage(); }
    }));
    document.querySelectorAll("[data-retention-v2-tab]").forEach(button => button.addEventListener("click", () => {
      view.activeTab = button.dataset.retentionV2Tab;
      view.error = "";
      service().setHistoryVisible(view.activeTab === "history");
      BlessERP.layout.renderPage();
    }));
    document.querySelector("#retention-v2-history-form")?.addEventListener("submit", async event => {
      event.preventDefault();
      const filters = readHistoryFilters();
      if (filters.dateFrom && filters.dateTo && filters.dateFrom > filters.dateTo) { view.error = "La fecha Desde no puede ser posterior a Hasta."; BlessERP.layout.renderPage(); return; }
      view.historyDraft = clone(filters); view.processing = true; view.error = ""; BlessERP.layout.renderPage();
      try { await service().queryHistory(filters, { page: 1, pageSize: filters.pageSize }); }
      catch (error) { view.error = error.message; }
      finally { view.processing = false; BlessERP.layout.renderPage(); }
    });
    document.querySelectorAll("[data-retention-v2-queue-page]").forEach(button => button.addEventListener("click", async () => {
      if (view.processing) return; view.processing = true; view.error = ""; BlessERP.layout.renderPage();
      try { await service().refreshQueue({ page: Number(button.dataset.retentionV2QueuePage), pageSize: snapshot.queue.pageSize }); }
      catch (error) { view.error = error.message; }
      finally { view.processing = false; BlessERP.layout.renderPage(); }
    }));
    document.querySelectorAll("[data-retention-v2-history-page]").forEach(button => button.addEventListener("click", async () => {
      if (view.processing || !snapshot.history.appliedFilters) return; view.processing = true; view.error = ""; BlessERP.layout.renderPage();
      try { await service().queryHistory(snapshot.history.appliedFilters, { page: Number(button.dataset.retentionV2HistoryPage), pageSize: snapshot.history.pageSize }); }
      catch (error) { view.error = error.message; }
      finally { view.processing = false; BlessERP.layout.renderPage(); }
    }));
    document.querySelectorAll("[data-retention-v2-from-purchase]").forEach(button => button.addEventListener("click", async () => {
      if (view.processing) return; view.processing = true; view.error = ""; BlessERP.layout.renderPage();
      try { view.draft = await service().prepareDraft(button.dataset.retentionV2FromPurchase); }
      catch (error) { view.error = error.message; }
      finally { view.processing = false; BlessERP.layout.renderPage(); }
    }));
    document.querySelector("#retention-v2-form")?.addEventListener("change", event => {
      view.draft = draftFromForm();
      const row = event.target.closest("[data-retention-v2-line]");
      if (row && ["taxType", "code"].includes(event.target.dataset.retentionV2Field)) {
        const line = view.draft.retentionLines.find(item => item.id === row.dataset.retentionV2Line);
        if (line) {
          if (event.target.dataset.retentionV2Field === "taxType") { line.code = ""; line.sriCode = ""; line.parameterId = ""; line.percentage = 0; line.description = ""; line.payableAccountCode = ""; }
          const parameter = catalog(line.taxType).find(item => item.code === line.code);
          if (parameter) { line.parameterId = parameter.id; line.sriCode = parameter.sriCode || parameter.code; line.percentage = Number(parameter.percentage || 0); line.description = parameter.description || ""; line.payableAccountCode = parameter.payableAccountCode || ""; line.retainedAmount = Math.round((line.baseAmount * line.percentage / 100 + Number.EPSILON) * 100) / 100; }
        }
        BlessERP.layout.renderPage();
      }
    });
    document.querySelector("[data-retention-v2-add]")?.addEventListener("click", () => { view.draft = draftFromForm(); view.draft.retentionLines.push({ id: `line-${crypto.randomUUID()}`, taxType: "RENTA", code: "", sriCode: "", description: "", baseAmount: 0, percentage: 0, retainedAmount: 0, payableAccountCode: "" }); BlessERP.layout.renderPage(); });
    document.querySelectorAll("[data-retention-v2-remove]").forEach(button => button.addEventListener("click", () => { view.draft = draftFromForm(); view.draft.retentionLines = view.draft.retentionLines.filter(line => line.id !== button.dataset.retentionV2Remove); BlessERP.layout.renderPage(); }));
    document.querySelector("[data-retention-v2-create]")?.addEventListener("click", async () => {
      if (view.processing) return; view.processing = true; view.error = ""; view.message = ""; view.draft = draftFromForm(); BlessERP.layout.renderPage();
      try { const result = await service().createOrGet(view.draft); view.draft = null; view.message = `Retención ${result.retention?.fullNumber || "tipo 07"} creada. Pendiente de autorización SRI.`; }
      catch (error) { view.error = error.message; }
      finally { view.processing = false; BlessERP.layout.renderPage(); }
    });
    document.querySelectorAll("[data-retention-v2-view]").forEach(button => button.addEventListener("click", async () => { try { view.detail = await service().detail(button.dataset.retentionV2View); view.error = ""; } catch (error) { view.error = error.message; } BlessERP.layout.renderPage(); }));
    document.querySelectorAll("[data-retention-v2-process]").forEach(button => button.addEventListener("click", async () => { if (view.processing || recoveryInFlight.has(button.dataset.retentionV2Process)) return; recoveryInFlight.add(button.dataset.retentionV2Process); view.processing = true; view.error = ""; BlessERP.layout.renderPage(); try { const detail = await service().process(button.dataset.retentionV2Process); view.detail = detail; view.message = `Retención ${detail.document?.full_number || ""}: ${statusLabel(detail.document?.status)}.`; } catch (error) { view.error = error.message; try { view.detail = await service().detail(button.dataset.retentionV2Process); } catch {} } finally { recoveryInFlight.delete(button.dataset.retentionV2Process); view.processing = false; BlessERP.layout.renderPage(); } }));
    document.querySelectorAll("[data-retention-v2-ride]").forEach(button => button.addEventListener("click", async () => {
      const row = findRetention(snapshot, button.dataset.retentionV2Ride); if (!row) return;
      try {
        if (row.status === "AUTORIZADO" || (row.status === "ANULADO" && row.authorizationNumber)) await service().downloadArtifact(row.id, "RIDE_PDF");
        else { const detail = await service().detail(row.id); const result = BlessERP.retentionRide?.open?.(detail.retention, detail.purchase, { print: false, note: "Vista previa de borrador. No constituye comprobante autorizado." }); if (!result?.ok) throw new Error(result?.message || "No se pudo abrir la vista previa RIDE."); }
      } catch (error) { view.error = error.message; BlessERP.layout.renderPage(); }
    }));
    document.querySelectorAll("[data-retention-v2-xml]").forEach(button => button.addEventListener("click", async () => { try { await service().downloadArtifact(button.dataset.retentionV2Xml, "AUTHORIZED_XML"); } catch (error) { view.error = error.message; BlessERP.layout.renderPage(); } }));
    document.querySelector("[data-retention-v2-detail-close]")?.addEventListener("click", () => { view.detail = null; BlessERP.layout.renderPage(); });
    document.querySelector("[data-retention-v2-detail-backdrop]")?.addEventListener("click", event => { if (event.target === event.currentTarget) { view.detail = null; BlessERP.layout.renderPage(); } });
    document.querySelector("[data-retention-v2-recover]")?.addEventListener("click", async event => {
      const documentId = event.currentTarget.dataset.retentionV2Recover;
      if (recoveryInFlight.has(documentId)) return;
      recoveryInFlight.add(documentId); view.error = ""; view.message = "";
      BlessERP.layout.renderPage();
      try {
        const detail = await service().recover(documentId);
        if (view.detail?.document?.id === documentId) {
          view.detail = detail;
          view.message = "Estado consultado con la misma clave de acceso.";
        }
      } catch (error) {
        if (view.detail?.document?.id === documentId) view.error = error.message;
      } finally {
        recoveryInFlight.delete(documentId);
        BlessERP.layout.renderPage();
      }
    });
  }

  BlessERP.purchaseWithholdingV2Ui = Object.freeze({ render });
})();
