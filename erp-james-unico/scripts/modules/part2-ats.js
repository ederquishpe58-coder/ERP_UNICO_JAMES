(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const { esc, money } = BlessERP.utils;
  const atsService = BlessERP.services.ats;

  const uiState = {
    tab: "generator",
    message: "",
    errors: [],
    selectedGenerationId: "",
    filters: null
  };

  function ensureFilters() {
    if (!uiState.filters) uiState.filters = atsService.resolveFilters({});
  }

  function ensureSelectedGeneration() {
    const rows = atsService.history();
    if (!rows.length) return null;
    if (!uiState.selectedGenerationId || !rows.some(item => item.id === uiState.selectedGenerationId)) {
      uiState.selectedGenerationId = rows[0].id;
    }
    return rows.find(item => item.id === uiState.selectedGenerationId) || rows[0];
  }

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
    const label = atsStatusLabel(status);
    const value = String(status || "").toLowerCase();
    const css = value.includes("anulado") || value.includes("error")
      ? "cancelled"
      : value.includes("validado") || value.includes("generado") || value.includes("aplicado")
        ? "authorized"
        : "pending";
    return `<span class="status-badge ${css}">${esc(label || "-")}</span>`;
  }

  function atsStatusLabel(status) {
    const labels = {
      BORRADOR: "Borrador ATS",
      PREPARADO: "Preparado para validacion",
      CON_ERRORES: "Con errores criticos",
      VALIDADO: "Validado internamente",
      GENERADO: "XML preliminar generado",
      ANULADO: "Anulado"
    };
    return labels[status] || status || "-";
  }

  function tabStrip() {
    return `
      <div class="ats-tab-strip">
        ${atsService.tabs.map(item => `
          <button class="ats-tab-button ${uiState.tab === item.id ? "active" : ""}" data-ats-tab="${esc(item.id)}">${esc(item.label)}</button>
        `).join("")}
      </div>
    `;
  }

  function feedbackBlock() {
    return `
      ${uiState.message ? `<section class="inline-feedback success">${esc(uiState.message)}</section>` : ""}
      ${uiState.errors.length ? `<section class="inline-feedback danger">${uiState.errors.map(item => `<div>${esc(item)}</div>`).join("")}</section>` : ""}
    `;
  }

  function summaryCards(generation) {
    const summary = generation?.summary || { purchases: 0, issued: 0, received: 0, errors: 0, warnings: 0 };
    return `
      <section class="summary-grid">
        <article class="summary-card"><span>Compras ATS</span><strong>${esc(String(summary.purchases))}</strong><small>Documentos listos para revision</small></article>
        <article class="summary-card"><span>Retenciones emitidas</span><strong>${esc(String(summary.issued))}</strong><small>Confirmadas o simuladas para el periodo</small></article>
        <article class="summary-card"><span>Retenciones recibidas</span><strong>${esc(String(summary.received))}</strong><small>Aplicadas y pendientes de relacion</small></article>
        <article class="summary-card"><span>Errores criticos</span><strong>${esc(String(summary.errors))}</strong><small>Bloquean la generacion final</small></article>
        <article class="summary-card"><span>Advertencias</span><strong>${esc(String(summary.warnings))}</strong><small>Requieren justificacion o correccion</small></article>
        <article class="summary-card"><span>Estado actual</span><strong>${esc(atsStatusLabel(generation?.status || "BORRADOR"))}</strong><small>${generation?.period ? `Periodo ${esc(generation.period)}` : "Sin generacion activa"}</small></article>
      </section>
    `;
  }

  function generationToolbar(activeGeneration) {
    ensureFilters();
    const filters = uiState.filters;
    return `
      <section class="panel-card compact-toolbar-card">
        <div class="compact-toolbar compact-toolbar-ats">
          <label class="compact-inline-field"><span>Anio</span><input id="ats-year" type="number" min="2020" max="2099" value="${esc(filters.year)}"></label>
          <label class="compact-inline-field">
            <span>Mes</span>
            <select id="ats-month">
              ${Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, "0")).map(month => `<option value="${month}" ${filters.month === month ? "selected" : ""}>${month}</option>`).join("")}
            </select>
          </label>
          <label class="compact-inline-field">
            <span>Periodicidad</span>
            <select id="ats-periodicity">
              ${atsService.periodicities.map(item => `<option value="${esc(item)}" ${filters.periodicity === item ? "selected" : ""}>${esc(item)}</option>`).join("")}
            </select>
          </label>
          <label class="compact-inline-field"><span>Fecha desde</span><input id="ats-date-from" type="date" value="${esc(filters.dateFrom || "")}"></label>
          <label class="compact-inline-field"><span>Fecha hasta</span><input id="ats-date-to" type="date" value="${esc(filters.dateTo || "")}"></label>
          <label class="compact-inline-field">
            <span>Estado doc.</span>
            <select id="ats-document-status">
              <option value="">Todos</option>
              <option value="CONTABILIZADO" ${filters.documentStatus === "CONTABILIZADO" ? "selected" : ""}>Contabilizado</option>
              <option value="RETENIDO" ${filters.documentStatus === "RETENIDO" ? "selected" : ""}>Retenido</option>
              <option value="ANULADO" ${filters.documentStatus === "ANULADO" ? "selected" : ""}>Anulado</option>
            </select>
          </label>
          <label class="compact-inline-field">
            <span>Comprobante</span>
            <select id="ats-voucher-type">
              <option value="">Todos</option>
              <option value="factura" ${filters.voucherType === "factura" ? "selected" : ""}>Factura</option>
              <option value="liquidacion_compra" ${filters.voucherType === "liquidacion_compra" ? "selected" : ""}>Liquidacion compra</option>
              <option value="nota_credito" ${filters.voucherType === "nota_credito" ? "selected" : ""}>Nota credito</option>
              <option value="nota_debito" ${filters.voucherType === "nota_debito" ? "selected" : ""}>Nota debito</option>
            </select>
          </label>
          <label class="compact-inline-field"><span>Proveedor</span><input id="ats-provider" value="${esc(filters.provider || "")}" placeholder="Proveedor"></label>
          <label class="compact-inline-field"><span>Cliente</span><input id="ats-customer" value="${esc(filters.customer || "")}" placeholder="Cliente"></label>
        </div>
        <div class="compact-toolbar-actions compact-toolbar-actions-ats">
          <button class="secondary-button" type="button" data-ats-prepare>Preparar ATS</button>
          <button class="secondary-button" type="button" data-ats-validate ${activeGeneration ? "" : "disabled"}>Validar ATS</button>
          <button class="secondary-button" type="button" data-ats-generate ${activeGeneration ? "" : "disabled"}>Generar XML preliminar</button>
          <button class="secondary-button" type="button" data-ats-download-xml ${activeGeneration ? "" : "disabled"}>Descargar XML preliminar</button>
          <button class="secondary-button" type="button" data-ats-download-review ${activeGeneration ? "" : "disabled"}>Descargar revision</button>
          <button class="secondary-button" type="button" data-ats-mark-generated ${activeGeneration ? "" : "disabled"}>Marcar XML preliminar</button>
          <button class="secondary-button danger" type="button" data-ats-annul ${activeGeneration ? "" : "disabled"}>Anular</button>
        </div>
      </section>
    `;
  }

  function configPanel() {
    const cfg = atsService.config();
    return `
      <article class="panel-card">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">CONFIGURACION</p>
            <h3>Datos del informante y parametros ATS</h3>
          </div>
          <button class="secondary-button" type="button" data-ats-save-config>Guardar configuracion</button>
        </div>
        <form id="ats-config-form" class="compact-form-grid">
          <label class="compact-field"><span>RUC empresa</span><input name="companyTaxId" value="${esc(cfg.companyTaxId || "")}"></label>
          <label class="compact-field full"><span>Razon social</span><input name="legalName" value="${esc(cfg.legalName || "")}"></label>
          <label class="compact-field full"><span>Nombre comercial</span><input name="commercialName" value="${esc(cfg.commercialName || "")}"></label>
          <label class="compact-field"><span>Periodo fiscal</span><input name="fiscalPeriod" value="${esc(cfg.fiscalPeriod || "")}"></label>
          <label class="compact-field">
            <span>Mes</span>
            <select name="month">
              ${Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, "0")).map(month => `<option value="${month}" ${cfg.month === month ? "selected" : ""}>${month}</option>`).join("")}
            </select>
          </label>
          <label class="compact-field"><span>Anio</span><input name="year" type="number" min="2020" max="2099" value="${esc(cfg.year || "")}"></label>
          <label class="compact-field">
            <span>Periodicidad</span>
            <select name="periodicity">
              ${atsService.periodicities.map(item => `<option value="${esc(item)}" ${cfg.periodicity === item ? "selected" : ""}>${esc(item)}</option>`).join("")}
            </select>
          </label>
          <label class="compact-field"><span>Tipo informante</span><input name="informantType" value="${esc(cfg.informantType || "")}"></label>
          <label class="compact-field">
            <span>Obligado contabilidad</span>
            <select name="accountingRequired">
              <option value="Si" ${cfg.accountingRequired === "Si" ? "selected" : ""}>Si</option>
              <option value="No" ${cfg.accountingRequired === "No" ? "selected" : ""}>No</option>
            </select>
          </label>
          <label class="compact-field"><span>Regimen tributario</span><input name="taxRegime" value="${esc(cfg.taxRegime || "")}"></label>
          <label class="compact-field">
            <span>Ambiente</span>
            <select name="environment">
              <option value="Pruebas" ${cfg.environment === "Pruebas" ? "selected" : ""}>Pruebas</option>
              <option value="Produccion" ${cfg.environment === "Produccion" ? "selected" : ""}>Produccion</option>
            </select>
          </label>
          <label class="compact-field">
            <span>Moneda</span>
            <select name="currency">
              <option value="USD" ${cfg.currency === "USD" ? "selected" : ""}>USD</option>
              <option value="EUR" ${cfg.currency === "EUR" ? "selected" : ""}>EUR</option>
            </select>
          </label>
          <label class="toggle-field"><input type="checkbox" name="includePostedPurchases" ${cfg.includePostedPurchases ? "checked" : ""}> <span>Incluir compras contabilizadas</span></label>
          <label class="toggle-field"><input type="checkbox" name="includeIssuedConfirmed" ${cfg.includeIssuedConfirmed ? "checked" : ""}> <span>Incluir retenciones emitidas confirmadas</span></label>
          <label class="toggle-field"><input type="checkbox" name="includeReceivedApplied" ${cfg.includeReceivedApplied ? "checked" : ""}> <span>Incluir retenciones recibidas aplicadas</span></label>
          <label class="toggle-field"><input type="checkbox" name="includeAnnulled" ${cfg.includeAnnulled ? "checked" : ""}> <span>Incluir anulados si aplica</span></label>
          <label class="toggle-field"><input type="checkbox" name="excludeDrafts" ${cfg.excludeDrafts ? "checked" : ""}> <span>Excluir borradores</span></label>
          <label class="toggle-field"><input type="checkbox" name="excludeDuplicates" ${cfg.excludeDuplicates ? "checked" : ""}> <span>Excluir duplicados</span></label>
          <label class="toggle-field"><input type="checkbox" name="validateAccounts" ${cfg.validateAccounts ? "checked" : ""}> <span>Validar cuentas contables</span></label>
          <label class="toggle-field"><input type="checkbox" name="validateTaxSupports" ${cfg.validateTaxSupports ? "checked" : ""}> <span>Validar sustentos tributarios</span></label>
          <label class="toggle-field"><input type="checkbox" name="validateAuthorizations" ${cfg.validateAuthorizations ? "checked" : ""}> <span>Validar autorizaciones y claves</span></label>
        </form>
      </article>
    `;
  }

  function generatorPanel(generation) {
    return `
      ${generationToolbar(generation)}
      ${summaryCards(generation)}
      <section class="placeholder-grid">
        <article class="panel-card">
          <div class="panel-card-head">
            <div>
              <p class="section-kicker">RESUMEN</p>
              <h3>Generacion activa</h3>
            </div>
            ${statusBadge(generation?.status || "BORRADOR")}
          </div>
          <div class="info-stack">
            <div class="info-row"><strong>Periodo</strong><span>${esc(generation?.period || "-")}</span></div>
            <div class="info-row"><strong>Origen</strong><span>${esc(generation?.sourceMode || "Sin generar")}</span></div>
            <div class="info-row"><strong>Creado</strong><span>${esc(generation?.createdAt || "-")}</span></div>
            <div class="info-row"><strong>Validado</strong><span>${esc(generation?.validatedAt || "-")}</span></div>
            <div class="info-row"><strong>Generado</strong><span>${esc(generation?.generatedAt || "-")}</span></div>
            <div class="info-row"><strong>Usuario</strong><span>${esc(generation?.userName || "-")}</span></div>
          </div>
          <p class="panel-note">El ATS base no envia nada al SRI y no garantiza aceptacion definitiva. Solo prepara estructura, realiza validaciones internas y deja un XML preliminar para revision, correccion por catalogo y ficha tecnica, y futura conversion/validacion externa.</p>
        </article>
        <article class="panel-card">
          <div class="panel-card-head">
            <div>
              <p class="section-kicker">ACCESOS</p>
              <h3>Relacion con otros modulos</h3>
            </div>
          </div>
          <div class="mini-route-grid">
            <button class="mini-route-card" data-route-link="reports-tax"><strong>Reporte compras por sustento</strong><span>Ir a reportes tributarios</span></button>
            <button class="mini-route-card" data-route-link="accounting-journal"><strong>Libro Diario</strong><span>Ver asientos relacionados</span></button>
            <button class="mini-route-card" data-route-link="accounting-ledger"><strong>Mayor General</strong><span>Consulta por cuenta</span></button>
            <button class="mini-route-card" data-ats-tab-target="validations"><strong>Validaciones ATS</strong><span>Corregir errores y advertencias</span></button>
          </div>
        </article>
      </section>
    `;
  }

  function purchasesTable(rows) {
    return `
      <article class="panel-card">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">COMPRAS ATS</p>
            <h3>Revision de compras incluidas</h3>
          </div>
          <span class="status-badge partial">${esc(String(rows.length))} filas</span>
        </div>
        <div class="compact-table-wrap">
          <table class="compact-table">
            <thead>
              <tr>
                <th>Fecha emision</th>
                <th>Proveedor</th>
                <th>RUC</th>
                <th>Comprobante</th>
                <th>Autorizacion</th>
                <th>Sustento</th>
                <th>Base 0%</th>
                <th>Base IVA</th>
                <th>IVA</th>
                <th>Total</th>
                <th>Ret. Fte</th>
                <th>Ret. IVA</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map(item => `
                <tr>
                  <td>${esc(item.issueDate)}</td>
                  <td><strong>${esc(item.supplierName)}</strong><small>${esc(item.purchaseType)}</small></td>
                  <td>${esc(item.supplierRuc)}</td>
                  <td>${esc(item.documentNumber || `${item.estab}-${item.ptoEmi}-${item.sequential}`)}</td>
                  <td>${esc(item.authorization || item.accessKey || "-")}</td>
                  <td>${esc(item.taxSupportCode || "-")} ${item.taxSupportName ? `<small>${esc(item.taxSupportName)}</small>` : ""}</td>
                  <td>${money(item.base0)}</td>
                  <td>${money(item.baseIva)}</td>
                  <td>${money(item.iva)}</td>
                  <td>${money(item.total)}</td>
                  <td>${money(item.retentionRent)}</td>
                  <td>${money(item.retentionVat)}</td>
                  <td>${statusBadge(item.status)}</td>
                </tr>
              `).join("") || `<tr><td colspan="13"><div class="empty-inline">No hay compras preparadas para este ATS.</div></td></tr>`}
            </tbody>
          </table>
        </div>
      </article>
    `;
  }

  function issuedTable(rows) {
    return `
      <article class="panel-card">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">RETENCIONES EMITIDAS ATS</p>
            <h3>Retenciones de compras relacionadas</h3>
          </div>
          <span class="status-badge partial">${esc(String(rows.length))} filas</span>
        </div>
        <div class="compact-table-wrap">
          <table class="compact-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Proveedor</th>
                <th>Compra</th>
                <th>Codigo</th>
                <th>Tipo</th>
                <th>Base</th>
                <th>%</th>
                <th>Valor retenido</th>
                <th>Estado</th>
                <th>Asiento</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map(item => `
                <tr>
                  <td>${esc(item.retentionDate)}</td>
                  <td><strong>${esc(item.supplierName)}</strong><small>${esc(item.supplierRuc)}</small></td>
                  <td>${esc(item.purchaseDocumentNumber || "-")}</td>
                  <td>${esc(item.sriCode || item.retentionCode || "-")}</td>
                  <td>${esc(item.taxType)}</td>
                  <td>${money(item.baseAmount)}</td>
                  <td>${esc(String(item.percentage))}%</td>
                  <td>${money(item.retainedAmount)}</td>
                  <td>${statusBadge(item.status)}</td>
                  <td>${esc(item.accountingEntryNumber || "-")}</td>
                </tr>
              `).join("") || `<tr><td colspan="10"><div class="empty-inline">No hay retenciones emitidas para este ATS.</div></td></tr>`}
            </tbody>
          </table>
        </div>
      </article>
    `;
  }

  function receivedTable(rows) {
    return `
      <article class="panel-card">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">RETENCIONES RECIBIDAS ATS</p>
            <h3>XML de clientes incluidos</h3>
          </div>
          <span class="status-badge partial">${esc(String(rows.length))} filas</span>
        </div>
        <div class="compact-table-wrap">
          <table class="compact-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Cliente</th>
                <th>Retencion</th>
                <th>Doc. sustento</th>
                <th>Codigo</th>
                <th>Tipo</th>
                <th>Base</th>
                <th>Valor retenido</th>
                <th>Estado</th>
                <th>Documento relacionado</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map(item => `
                <tr>
                  <td>${esc(item.issueDate)}</td>
                  <td><strong>${esc(item.customerName)}</strong><small>${esc(item.customerTaxId)}</small></td>
                  <td>${esc(item.documentNumber)}</td>
                  <td>${esc(item.supportDocumentNumber || "-")}</td>
                  <td>${esc(item.sriCode || item.retentionCode || "-")}</td>
                  <td>${esc(item.taxType)}</td>
                  <td>${money(item.baseAmount)}</td>
                  <td>${money(item.retainedAmount)}</td>
                  <td>${statusBadge(item.status)}</td>
                  <td>${esc(item.relatedDocumentNumber || "-")}</td>
                </tr>
              `).join("") || `<tr><td colspan="10"><div class="empty-inline">No hay retenciones recibidas para este ATS.</div></td></tr>`}
            </tbody>
          </table>
        </div>
      </article>
    `;
  }

  function validationsTable(generation) {
    const rows = generation?.validations || [];
    return `
      <article class="panel-card">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">VALIDACIONES ATS</p>
            <h3>Errores y advertencias del periodo</h3>
          </div>
          <span class="status-badge pending">${esc(String(rows.length))} validaciones</span>
        </div>
        <div class="compact-table-wrap">
          <table class="compact-table">
            <thead>
              <tr>
                <th>Tipo</th>
                <th>Modulo</th>
                <th>Documento</th>
                <th>Descripcion</th>
                <th>Accion sugerida</th>
                <th>Estado</th>
                <th>Accion</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map(item => `
                <tr>
                  <td>${statusBadge(item.severity === "error" ? "Error" : "Advertencia")}</td>
                  <td>${esc(item.moduleOrigin)}</td>
                  <td>${esc(item.documentLabel)}</td>
                  <td>${esc(item.description)}</td>
                  <td>${esc(item.suggestedAction)}</td>
                  <td>${esc(item.status)}${item.justification ? `<small>${esc(item.justification)}</small>` : ""}</td>
                  <td>
                    <div class="row-actions">
                      ${item.severity === "warning" && item.status === "pendiente" ? `<button class="row-action-button" type="button" data-ats-ignore-validation="${esc(item.id)}">Ignorar</button>` : ""}
                      ${item.status === "ignorado" ? `<button class="row-action-button" type="button" data-ats-restore-validation="${esc(item.id)}">Restaurar</button>` : ""}
                    </div>
                  </td>
                </tr>
              `).join("") || `<tr><td colspan="7"><div class="empty-inline">No hay validaciones para la generacion activa.</div></td></tr>`}
            </tbody>
          </table>
        </div>
      </article>
    `;
  }

  function exportPanel(generation) {
    const xml = generation ? atsService.buildXmlPreview(generation) : "";
    const json = generation ? atsService.buildJsonPreview(generation) : "";
    return `
      <section class="placeholder-grid">
        <article class="panel-card">
          <div class="panel-card-head">
            <div>
              <p class="section-kicker">XML BASE</p>
            <h3>Vista previa de XML preliminar</h3>
          </div>
          <button class="secondary-button" type="button" data-ats-download-xml ${generation ? "" : "disabled"}>Descargar XML preliminar</button>
        </div>
        <p class="panel-note">Este archivo es preliminar. Debe revisarse, corregirse y validarse con el instructivo, catalogos y ficha tecnica ATS antes de considerarlo listo para uso externo.</p>
        <textarea class="ats-preview" readonly>${esc(xml)}</textarea>
      </article>
      <article class="panel-card">
          <div class="panel-card-head">
            <div>
              <p class="section-kicker">JSON TECNICO</p>
              <h3>Revision estructurada</h3>
            </div>
            <button class="secondary-button" type="button" data-ats-download-json ${generation ? "" : "disabled"}>Descargar JSON</button>
          </div>
          <textarea class="ats-preview" readonly>${esc(json)}</textarea>
        </article>
      </section>
    `;
  }

  function historyPanel(rows) {
    return `
      <article class="panel-card">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">HISTORIAL</p>
            <h3>Generaciones ATS almacenadas</h3>
          </div>
          <span class="status-badge partial">${esc(String(rows.length))} registros</span>
        </div>
        <div class="compact-table-wrap">
          <table class="compact-table">
            <thead>
              <tr>
                <th>Periodo</th>
                <th>Fecha generacion</th>
                <th>Estado</th>
                <th>Compras</th>
                <th>Ret. emitidas</th>
                <th>Ret. recibidas</th>
                <th>Errores</th>
                <th>Advertencias</th>
                <th>Usuario</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map(item => `
                <tr>
                  <td>${esc(item.period)}</td>
                  <td>${esc(item.generatedAt || item.validatedAt || item.createdAt || "-")}</td>
                  <td>${statusBadge(item.status)}</td>
                  <td>${esc(String(item.summary?.purchases || 0))}</td>
                  <td>${esc(String(item.summary?.issued || 0))}</td>
                  <td>${esc(String(item.summary?.received || 0))}</td>
                  <td>${esc(String(item.summary?.errors || 0))}</td>
                  <td>${esc(String(item.summary?.warnings || 0))}</td>
                  <td>${esc(item.userName || "-")}</td>
                  <td>
                    <div class="row-actions">
                      <button class="row-action-button" type="button" data-ats-open-history="${esc(item.id)}">Ver detalle</button>
                      <button class="row-action-button" type="button" data-ats-history-revalidate="${esc(item.id)}">Revalidar</button>
                      <button class="row-action-button" type="button" data-ats-history-download="${esc(item.id)}">Descargar JSON</button>
                      ${item.status !== "ANULADO" ? `<button class="row-action-button" type="button" data-ats-history-annul="${esc(item.id)}">Anular</button>` : ""}
                    </div>
                  </td>
                </tr>
              `).join("") || `<tr><td colspan="10"><div class="empty-inline">No hay generaciones ATS guardadas.</div></td></tr>`}
            </tbody>
          </table>
        </div>
      </article>
    `;
  }

  function salesFuturePanel() {
    return `
      <section class="future-banner">
        <strong>Ventas ATS en fase futura</strong>
        <span>Las ventas, exportaciones y facturacion SRI se implementaran en una fase posterior. Este ATS base prepara la estructura, pero por ahora no genera ventas reales.</span>
      </section>
    `;
  }

  function pageContent(activeGeneration) {
    if (uiState.tab === "config") return configPanel();
    if (uiState.tab === "purchases") return purchasesTable(activeGeneration?.dataset?.purchases || []);
    if (uiState.tab === "issued") return issuedTable(activeGeneration?.dataset?.issued || []);
    if (uiState.tab === "received") return receivedTable(activeGeneration?.dataset?.received || []);
    if (uiState.tab === "validations") return validationsTable(activeGeneration);
    if (uiState.tab === "export") return exportPanel(activeGeneration);
    if (uiState.tab === "history") return historyPanel(atsService.history());
    if (uiState.tab === "sales") return salesFuturePanel();
    return generatorPanel(activeGeneration);
  }

  function render(container, route) {
    ensureFilters();
    const activeGeneration = ensureSelectedGeneration();
    container.innerHTML = `
      <section class="page-header">
        <div>
          <p class="section-kicker">${esc(route.groupLabel.toUpperCase())}</p>
          <h1>${esc(route.title)}</h1>
          <p>Modulo base para preparar, validar, revisar y exportar informacion preliminar del ATS con compras y retenciones ya existentes en la base administrativa actual, sin prometer aun aceptacion final por parte del SRI.</p>
        </div>
        <div class="page-header-side">
          ${statusBadge(activeGeneration?.status || "BORRADOR")}
        </div>
      </section>
      ${routeTabs(route)}
      ${feedbackBlock()}
      ${tabStrip()}
      ${pageContent(activeGeneration)}
    `;
    bind();
  }

  function collectFiltersFromToolbar() {
    ensureFilters();
    const current = { ...uiState.filters };
    const read = id => document.querySelector(id)?.value || "";
    uiState.filters = atsService.resolveFilters({
      ...current,
      year: read("#ats-year") || current.year,
      month: read("#ats-month") || current.month,
      periodicity: read("#ats-periodicity") || current.periodicity,
      dateFrom: read("#ats-date-from") || current.dateFrom,
      dateTo: read("#ats-date-to") || current.dateTo,
      documentStatus: read("#ats-document-status") || "",
      voucherType: read("#ats-voucher-type") || "",
      provider: read("#ats-provider") || "",
      customer: read("#ats-customer") || ""
    });
  }

  function collectConfigForm() {
    const form = document.querySelector("#ats-config-form");
    if (!form) return atsService.config();
    return {
      companyTaxId: form.elements.companyTaxId?.value || "",
      legalName: form.elements.legalName?.value || "",
      commercialName: form.elements.commercialName?.value || "",
      fiscalPeriod: form.elements.fiscalPeriod?.value || "",
      month: form.elements.month?.value || "06",
      year: form.elements.year?.value || "2026",
      periodicity: form.elements.periodicity?.value || "mensual",
      informantType: form.elements.informantType?.value || "",
      accountingRequired: form.elements.accountingRequired?.value || "Si",
      taxRegime: form.elements.taxRegime?.value || "",
      environment: form.elements.environment?.value || "Pruebas",
      currency: form.elements.currency?.value || "USD",
      includePostedPurchases: Boolean(form.elements.includePostedPurchases?.checked),
      includeIssuedConfirmed: Boolean(form.elements.includeIssuedConfirmed?.checked),
      includeReceivedApplied: Boolean(form.elements.includeReceivedApplied?.checked),
      includeAnnulled: Boolean(form.elements.includeAnnulled?.checked),
      excludeDrafts: Boolean(form.elements.excludeDrafts?.checked),
      excludeDuplicates: Boolean(form.elements.excludeDuplicates?.checked),
      validateAccounts: Boolean(form.elements.validateAccounts?.checked),
      validateTaxSupports: Boolean(form.elements.validateTaxSupports?.checked),
      validateAuthorizations: Boolean(form.elements.validateAuthorizations?.checked)
    };
  }

  function downloadFile(payload) {
    if (!payload?.ok) return;
    const blob = new Blob([payload.content], { type: payload.mime || "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = payload.filename || "archivo.txt";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function bind() {
    document.querySelectorAll("[data-ats-tab]").forEach(button => button.addEventListener("click", () => {
      uiState.tab = button.dataset.atsTab;
      BlessERP.layout.renderPage();
    }));

    document.querySelectorAll("[data-ats-tab-target]").forEach(button => button.addEventListener("click", () => {
      uiState.tab = button.dataset.atsTabTarget;
      BlessERP.layout.renderPage();
    }));

    document.querySelector("[data-ats-save-config]")?.addEventListener("click", () => {
      atsService.saveConfig(collectConfigForm());
      uiState.message = "Configuracion ATS guardada correctamente.";
      uiState.errors = [];
      uiState.filters = atsService.resolveFilters(uiState.filters || {});
      BlessERP.layout.renderPage();
    });

    document.querySelector("[data-ats-prepare]")?.addEventListener("click", () => {
      collectFiltersFromToolbar();
      const generation = atsService.prepareGeneration(uiState.filters);
      uiState.selectedGenerationId = generation.id;
      uiState.message = `ATS ${generation.period} preparado en estado ${atsStatusLabel(generation.status)}.`;
      uiState.errors = [];
      BlessERP.layout.renderPage();
    });

    document.querySelector("[data-ats-validate]")?.addEventListener("click", () => {
      const result = atsService.revalidateGeneration(uiState.selectedGenerationId);
      if (!result.ok) {
        uiState.errors = [result.message || "No se pudo validar el ATS."];
        uiState.message = "";
        return BlessERP.layout.renderPage();
      }
      uiState.message = `ATS ${result.generation.period} revalidado. Estado actual: ${atsStatusLabel(result.generation.status)}.`;
      uiState.errors = [];
      BlessERP.layout.renderPage();
    });

    document.querySelector("[data-ats-generate]")?.addEventListener("click", () => {
      const current = atsService.findGenerationById(uiState.selectedGenerationId);
      if (!current) {
        uiState.errors = ["No existe una generacion ATS seleccionada."];
        uiState.message = "";
        return BlessERP.layout.renderPage();
      }
      uiState.message = "Vista previa preliminar XML/JSON actualizada. Aun requiere revision y validacion externa segun el instructivo ATS.";
      uiState.errors = [];
      uiState.tab = "export";
      BlessERP.layout.renderPage();
    });

    document.querySelector("[data-ats-mark-generated]")?.addEventListener("click", () => {
      const result = atsService.markGenerated(uiState.selectedGenerationId);
      if (!result.ok) {
        uiState.errors = [result.message || "No se pudo marcar el ATS como XML preliminar generado."];
        uiState.message = "";
        return BlessERP.layout.renderPage();
      }
      uiState.message = `ATS ${result.generation.period} marcado como XML preliminar generado. Este estado no implica aceptacion del SRI.`;
      uiState.errors = [];
      uiState.tab = "history";
      BlessERP.layout.renderPage();
    });

    document.querySelector("[data-ats-annul]")?.addEventListener("click", () => {
      const reason = window.prompt("Motivo de anulacion del ATS:", "Correccion tributaria") || "";
      const result = atsService.annulGeneration(uiState.selectedGenerationId, reason);
      if (!result.ok) {
        uiState.errors = [result.message || "No se pudo anular la generacion ATS."];
        uiState.message = "";
        return BlessERP.layout.renderPage();
      }
      uiState.message = `ATS ${result.generation.period} anulado.`;
      uiState.errors = [];
      uiState.tab = "history";
      BlessERP.layout.renderPage();
    });

    document.querySelector("[data-ats-download-xml]")?.addEventListener("click", () => downloadFile(atsService.exportPayload(uiState.selectedGenerationId, "xml")));
    document.querySelector("[data-ats-download-json]")?.addEventListener("click", () => downloadFile(atsService.exportPayload(uiState.selectedGenerationId, "json")));
    document.querySelector("[data-ats-download-review]")?.addEventListener("click", () => downloadFile(atsService.exportPayload(uiState.selectedGenerationId, "review")));

    document.querySelectorAll("[data-ats-ignore-validation]").forEach(button => button.addEventListener("click", () => {
      const reason = window.prompt("Justificacion para ignorar esta advertencia:", "Pendiente de correccion documental") || "";
      const result = atsService.updateValidationStatus(uiState.selectedGenerationId, button.dataset.atsIgnoreValidation, "ignorado", reason);
      if (!result.ok) {
        uiState.errors = [result.message || "No se pudo actualizar la validacion."];
        uiState.message = "";
        return BlessERP.layout.renderPage();
      }
      uiState.message = "Advertencia justificada correctamente.";
      uiState.errors = [];
      BlessERP.layout.renderPage();
    }));

    document.querySelectorAll("[data-ats-restore-validation]").forEach(button => button.addEventListener("click", () => {
      const result = atsService.updateValidationStatus(uiState.selectedGenerationId, button.dataset.atsRestoreValidation, "pendiente", "");
      if (!result.ok) {
        uiState.errors = [result.message || "No se pudo restaurar la validacion."];
        uiState.message = "";
        return BlessERP.layout.renderPage();
      }
      uiState.message = "La validacion volvio a estado pendiente.";
      uiState.errors = [];
      BlessERP.layout.renderPage();
    }));

    document.querySelectorAll("[data-ats-open-history]").forEach(button => button.addEventListener("click", () => {
      uiState.selectedGenerationId = button.dataset.atsOpenHistory;
      uiState.tab = "generator";
      BlessERP.layout.renderPage();
    }));

    document.querySelectorAll("[data-ats-history-revalidate]").forEach(button => button.addEventListener("click", () => {
      uiState.selectedGenerationId = button.dataset.atsHistoryRevalidate;
      const result = atsService.revalidateGeneration(uiState.selectedGenerationId);
      if (!result.ok) {
        uiState.errors = [result.message || "No se pudo revalidar el historico ATS."];
        uiState.message = "";
        return BlessERP.layout.renderPage();
      }
      uiState.message = `Generacion ${result.generation.period} revalidada.`;
      uiState.errors = [];
      BlessERP.layout.renderPage();
    }));

    document.querySelectorAll("[data-ats-history-download]").forEach(button => button.addEventListener("click", () => {
      downloadFile(atsService.exportPayload(button.dataset.atsHistoryDownload, "json"));
    }));

    document.querySelectorAll("[data-ats-history-annul]").forEach(button => button.addEventListener("click", () => {
      const reason = window.prompt("Motivo de anulacion del historico ATS:", "Reemplazado por nueva generacion") || "";
      const result = atsService.annulGeneration(button.dataset.atsHistoryAnnul, reason);
      if (!result.ok) {
        uiState.errors = [result.message || "No se pudo anular el historico ATS."];
        uiState.message = "";
        return BlessERP.layout.renderPage();
      }
      uiState.message = `Historico ATS ${result.generation.period} anulado.`;
      uiState.errors = [];
      BlessERP.layout.renderPage();
    }));
  }

  BlessERP.modules = BlessERP.modules || {};
  BlessERP.modules.part2Ats = { render };
})();
