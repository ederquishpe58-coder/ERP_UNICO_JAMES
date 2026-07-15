(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const utils = BlessERP.comercialUtils;
  const calculator = BlessERP.comercialPackagingCalculator;

  function renderSummaryCards(result) {
    const summary = result.summary;
    return `
      <section class="summary-grid">
        <article class="summary-card">
          <span>Total materiales requeridos</span>
          <strong>${utils.esc(utils.number(summary.totalUnitsRequired))}</strong>
          <small>${utils.esc(summary.totalMaterialTypes)} tipos de material</small>
        </article>
        <article class="summary-card">
          <span>Materiales OK</span>
          <strong>${utils.esc(summary.okCount)}</strong>
          <small>Stock demo suficiente</small>
        </article>
        <article class="summary-card">
          <span>Materiales faltantes</span>
          <strong>${utils.esc(summary.missingCount)}</strong>
          <small>Requieren reposicion futura</small>
        </article>
        <article class="summary-card">
          <span>Materiales parciales</span>
          <strong>${utils.esc(summary.partialCount)}</strong>
          <small>Stock demo insuficiente</small>
        </article>
        <article class="summary-card">
          <span>Cajas requeridas</span>
          <strong>${utils.esc(utils.number(summary.cartonsRequired))}</strong>
          <small>HB / QB / EB</small>
        </article>
        <article class="summary-card">
          <span>Etiquetas requeridas</span>
          <strong>${utils.esc(utils.number(summary.boxLabelsRequired + summary.bunchLabelsRequired))}</strong>
          <small>Caja: ${utils.esc(utils.number(summary.boxLabelsRequired))} · Ramo: ${utils.esc(utils.number(summary.bunchLabelsRequired))}</small>
        </article>
        <article class="summary-card">
          <span>Ligas / capuchones</span>
          <strong>${utils.esc(utils.number(summary.tiesRequired + summary.capuchonesRequired))}</strong>
          <small>Ligas: ${utils.esc(utils.number(summary.tiesRequired))} · Capuchones: ${utils.esc(utils.number(summary.capuchonesRequired))}</small>
        </article>
      </section>
    `;
  }

  function renderRequirementRows(result) {
    return result.requirements.map(item => `
      <tr>
        <td>${utils.esc(item.code)}</td>
        <td>${utils.esc(item.name)}</td>
        <td>${utils.esc(item.category)}</td>
        <td>${utils.esc(item.unit)}</td>
        <td class="numeric">${utils.esc(utils.number(item.required))}</td>
        <td class="numeric">${utils.esc(utils.number(item.available))}</td>
        <td class="numeric">${utils.esc(utils.number(item.missing))}</td>
        <td>${utils.esc(item.warehouse)}</td>
        <td><span class="status-badge ${utils.badgeClass(item.state)}">${utils.esc(item.state)}</span></td>
        <td>${utils.esc(item.observation)}</td>
      </tr>
    `).join("");
  }

  function renderMaterialTable(result) {
    return `
      <article class="panel-card">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">BODEGA / EMPAQUE</p>
            <h3>Requerimiento por material</h3>
          </div>
          <span class="status-badge ${utils.badgeClass(result.summary.orderPackagingStatus)}">${utils.esc(result.summary.orderPackagingStatus)}</span>
        </div>
        <div class="compact-table-wrap">
          <table class="compact-table commercial-table">
            <thead>
              <tr>
                <th>Código material</th>
                <th>Material</th>
                <th>Categoría</th>
                <th>Unidad</th>
                <th>Requerido</th>
                <th>Disponible demo</th>
                <th>Faltante</th>
                <th>Bodega</th>
                <th>Estado</th>
                <th>Observación</th>
              </tr>
            </thead>
            <tbody>
              ${renderRequirementRows(result) || `<tr><td colspan="10">Sin materiales calculados para este pedido.</td></tr>`}
            </tbody>
          </table>
        </div>
      </article>
    `;
  }

  function renderBoxDetail(result) {
    return `
      <article class="panel-card">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">DETALLE POR CAJA</p>
            <h3>Materiales por caja</h3>
          </div>
        </div>
        <div class="placeholder-grid">
          ${result.boxDetails.length ? result.boxDetails.map(detail => `
            <article class="panel-card">
              <div class="panel-card-head">
                <div>
                  <p class="section-kicker">CAJA ${utils.esc(detail.boxNumber)}</p>
                  <h3>${utils.esc(detail.boxType)}</h3>
                </div>
                <span class="status-badge ${detail.missingRule ? "pending" : "partial"}">${detail.missingRule ? "Sin regla" : "Calculada"}</span>
              </div>
              <div class="info-stack">
                <div class="info-row"><strong>Variedades</strong><span>${utils.esc(detail.varieties.join(" / ") || "-")}</span></div>
                <div class="info-row"><strong>Ramos</strong><span>${utils.esc(utils.number(detail.bunches))}</span></div>
                <div class="info-row"><strong>Tallos</strong><span>${utils.esc(utils.number(detail.stems))}</span></div>
              </div>
              <div class="base-ready-list">
                ${detail.materials.length ? detail.materials.map(item => `
                  <div class="base-ready-item">
                    <strong>${utils.esc(item.name)}</strong>
                    <span>${utils.esc(utils.number(item.required))} ${utils.esc(item.unit)}</span>
                  </div>
                `).join("") : `<div class="empty-inline">Caja sin material configurado o sin regla de empaque.</div>`}
              </div>
            </article>
          `).join("") : `<div class="empty-inline">Aun no hay cajas cargadas en el pedido.</div>`}
        </div>
      </article>
    `;
  }

  function renderToolbar(result, appState) {
    const viewMode = BlessERP.comercialState.getUi(appState).packagingViewMode || "material";
    return `
      <section class="hero-banner commercial-inline-banner">
        <div>
          <strong>Conexión real de stock pendiente.</strong>
          <span>Esta pantalla calcula requerimientos del pedido y luego se conectará con el inventario de suministros / empaque.</span>
        </div>
        <span class="status-badge ${utils.badgeClass(result.summary.orderPackagingStatus)}">${utils.esc(result.summary.orderPackagingStatus)}</span>
      </section>
      <div class="table-actions-inline">
        <button class="secondary-button" data-commercial-packaging-recalculate>Recalcular materiales</button>
        <button class="secondary-button ${viewMode === "boxes" ? "is-active" : ""}" data-commercial-packaging-view="boxes">Ver detalle por caja</button>
        <button class="secondary-button ${viewMode === "material" ? "is-active" : ""}" data-commercial-packaging-view="material">Ver detalle por material</button>
        <button class="secondary-button" data-commercial-packaging-prepared>Marcar como preparado, demo</button>
        <button class="secondary-button" data-commercial-packaging-consumed>Marcar como consumido demo</button>
        <button class="secondary-button" data-commercial-packaging-placeholder="restock">Solicitar reposición</button>
        <button class="secondary-button" data-route-link="inventory-summary">Ver stock en Inventario de suministros / empaque</button>
      </div>
    `;
  }

  function renderWarnings(result) {
    return `
      <article class="panel-card">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">VALIDACIONES BODEGA</p>
            <h3>Advertencias de esta fase</h3>
          </div>
        </div>
        <ul class="checklist-list">
          ${result.warnings.map(item => `<li>${utils.esc(item)}</li>`).join("")}
          <li>Pedido puede validarse comercialmente, pero bodega tiene materiales faltantes.</li>
          <li>No se consume inventario real ni se genera asiento contable en esta fase.</li>
        </ul>
      </article>
    `;
  }

  function renderWorkspace(order, appState) {
    const result = calculator.calculateOrderRequirements(order, appState);
    const viewMode = BlessERP.comercialState.getUi(appState).packagingViewMode || "material";

    return `
      ${renderSummaryCards(result)}
      ${renderToolbar(result, appState)}
      <section class="placeholder-grid">
        ${renderWarnings(result)}
        <article class="panel-card">
          <div class="panel-card-head">
            <div>
              <p class="section-kicker">CONTRATO</p>
              <h3>packagingRequirementContract</h3>
            </div>
            <span class="status-badge partial">Demo activo</span>
          </div>
          <div class="info-stack">
            <div class="info-row"><strong>Pedido</strong><span>${utils.esc(order.number || "-")}</span></div>
            <div class="info-row"><strong>Filas contrato</strong><span>${utils.esc(result.contractRows.length)}</span></div>
            <div class="info-row"><strong>Origen cálculo</strong><span>pedido_maestro</span></div>
            <div class="info-row"><strong>Consumo real</strong><span>Pendiente</span></div>
          </div>
          <div class="table-actions-inline">
            <button class="secondary-button" data-commercial-preview-doc="PACKAGING_REQUIREMENTS">Vista previa requerimiento bodega</button>
            <button class="secondary-button" data-commercial-print-doc="PACKAGING_REQUIREMENTS">Imprimir requerimiento</button>
            <button class="secondary-button" data-commercial-doc-placeholder="pdf|PACKAGING_REQUIREMENTS">Descargar PDF</button>
          </div>
        </article>
      </section>
      ${viewMode === "boxes" ? renderBoxDetail(result) : renderMaterialTable(result)}
    `;
  }

  function renderReport(appState) {
    const orders = BlessERP.comercialState.getOrders(appState);
    const rows = orders.map(order => calculator.calculateOrderRequirements(order, appState));
    const totalRequired = rows.reduce((sum, row) => sum + row.summary.totalUnitsRequired, 0);
    const totalMissing = rows.reduce((sum, row) => sum + row.summary.missingCount, 0);

    return `
      <section class="page-header">
        <div>
          <p class="section-kicker">COMERCIAL / EXPORTACIONES</p>
          <h1>Reporte materiales por pedido</h1>
          <p>Reporte demo de requerimientos de bodega / empaque por pedido comercial, sin consumir inventario real.</p>
        </div>
        <div class="page-header-side">
          <span class="status-badge partial">Demo / contrato</span>
        </div>
      </section>
      <section class="summary-grid">
        <article class="summary-card">
          <span>Pedidos analizados</span>
          <strong>${utils.esc(rows.length)}</strong>
          <small>Base comercial demo</small>
        </article>
        <article class="summary-card">
          <span>Total materiales requeridos</span>
          <strong>${utils.esc(utils.number(totalRequired))}</strong>
          <small>Suma demo consolidada</small>
        </article>
        <article class="summary-card">
          <span>Pedidos con faltantes</span>
          <strong>${utils.esc(rows.filter(item => item.summary.missingCount > 0).length)}</strong>
          <small>Requieren reposición futura</small>
        </article>
        <article class="summary-card">
          <span>Faltantes totales</span>
          <strong>${utils.esc(totalMissing)}</strong>
          <small>Tipos de material faltantes</small>
        </article>
      </section>
      <section class="panel-card">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">BODEGA / EMPAQUE</p>
            <h3>Materiales por pedido</h3>
          </div>
        </div>
        <div class="compact-table-wrap">
          <table class="compact-table commercial-table">
            <thead>
              <tr>
                <th>Pedido</th>
                <th>Fecha vuelo</th>
                <th>Marca</th>
                <th>Destino</th>
                <th>Total cajas</th>
                <th>Total materiales requeridos</th>
                <th>Materiales faltantes</th>
                <th>Estado bodega</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map(row => {
                const brand = utils.findBrand(row.order.brandId);
                return `
                  <tr>
                    <td>${utils.esc(row.order.number)}</td>
                    <td>${utils.esc(utils.dateLabel(row.order.flightDate))}</td>
                    <td>${utils.esc(brand?.name || "-")}</td>
                    <td>${utils.esc(row.order.destination || "-")}</td>
                    <td class="numeric">${utils.esc(utils.number(row.metrics.totalBoxes))}</td>
                    <td class="numeric">${utils.esc(utils.number(row.summary.totalUnitsRequired))}</td>
                    <td class="numeric">${utils.esc(row.summary.missingCount)}</td>
                    <td><span class="status-badge ${utils.badgeClass(row.summary.orderPackagingStatus)}">${utils.esc(row.summary.orderPackagingStatus)}</span></td>
                    <td>
                      <div class="table-actions-inline commercial-action-stack">
                        <button class="secondary-button" data-commercial-open-order="${utils.esc(row.order.id)}">Abrir Pedido Maestro</button>
                        <button class="secondary-button" data-commercial-preview-order-doc="${utils.esc(row.order.id)}|PACKAGING_REQUIREMENTS">Vista previa bodega</button>
                        <button class="secondary-button" data-commercial-preview-order-doc="${utils.esc(row.order.id)}|PACKAGING_REQUIREMENTS|print">Imprimir bodega</button>
                      </div>
                    </td>
                  </tr>
                `;
              }).join("") || `<tr><td colspan="9">No hay pedidos demo para analizar.</td></tr>`}
            </tbody>
          </table>
        </div>
      </section>
    `;
  }

  function renderPrintDocument(order, appState) {
    const result = calculator.calculateOrderRequirements(order, appState);
    const brand = utils.findBrand(result.order.brandId);
    return `
      <article class="doc-page">
        <div class="doc-header">
          <div class="doc-company">
            <span class="doc-kicker">Bodega / Empaque</span>
            <strong class="doc-company-logo">BLESS FLOWER</strong>
            <h2 class="doc-title">REQUERIMIENTO DE MATERIALES / BODEGA</h2>
            <p class="doc-subtitle">Documento demo interno para preparar materiales de empaque del pedido.</p>
          </div>
          <div class="doc-box">
            <h4>Cabecera</h4>
            <div class="doc-row"><span>Pedido</span><span>${utils.esc(result.order.number)}</span></div>
            <div class="doc-row"><span>Marca</span><span>${utils.esc(brand?.name || "-")}</span></div>
            <div class="doc-row"><span>Fecha vuelo</span><span>${utils.esc(utils.dateLabel(result.order.flightDate))}</span></div>
            <div class="doc-row"><span>Destino</span><span>${utils.esc(result.order.destination || "-")}</span></div>
            <div class="doc-row"><span>Total cajas</span><span>${utils.esc(result.metrics.totalBoxes)}</span></div>
            <div class="doc-row"><span>Estado general</span><span>${utils.esc(result.summary.orderPackagingStatus)}</span></div>
          </div>
        </div>
        <div class="doc-table-wrap">
          <table class="doc-table">
            <thead>
              <tr>
                <th>Código</th>
                <th>Material</th>
                <th>Unidad</th>
                <th>Requerido</th>
                <th>Disponible demo</th>
                <th>Faltante</th>
                <th>Bodega</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              ${result.requirements.map(item => `
                <tr>
                  <td>${utils.esc(item.code)}</td>
                  <td>${utils.esc(item.name)}</td>
                  <td>${utils.esc(item.unit)}</td>
                  <td class="numeric">${utils.esc(utils.number(item.required))}</td>
                  <td class="numeric">${utils.esc(utils.number(item.available))}</td>
                  <td class="numeric">${utils.esc(utils.number(item.missing))}</td>
                  <td>${utils.esc(item.warehouse)}</td>
                  <td>${utils.esc(item.state)}</td>
                </tr>
              `).join("") || `<tr><td colspan="8">Sin materiales calculados.</td></tr>`}
            </tbody>
          </table>
        </div>
        <div class="doc-footer-grid">
          <section class="doc-box">
            <h4>Observaciones</h4>
            <ul class="doc-list">
              ${result.warnings.map(item => `<li>${utils.esc(item)}</li>`).join("")}
              <li>No consumir inventario real todavía.</li>
              <li>No generar asiento contable todavía.</li>
            </ul>
          </section>
          <section class="doc-box">
            <h4>Resumen</h4>
            <div class="doc-row"><span>Materiales OK</span><span>${utils.esc(result.summary.okCount)}</span></div>
            <div class="doc-row"><span>Materiales faltantes</span><span>${utils.esc(result.summary.missingCount)}</span></div>
            <div class="doc-row"><span>Materiales parciales</span><span>${utils.esc(result.summary.partialCount)}</span></div>
            <div class="doc-row"><span>Etiquetas requeridas</span><span>${utils.esc(utils.number(result.summary.boxLabelsRequired + result.summary.bunchLabelsRequired))}</span></div>
          </section>
        </div>
      </article>
    `;
  }

  BlessERP.comercialPackagingView = {
    renderPrintDocument,
    renderReport,
    renderWorkspace
  };
})();
