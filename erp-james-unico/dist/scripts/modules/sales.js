(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const { money, esc } = BlessERP.utils;
  const { state, openDetail, closeDetail, markDirty, createEmptySale, upsertSale, removeSale } = BlessERP.state;

  function statusClass(status) {
    const value = String(status || "").toLowerCase();
    if (value.includes("autorizado") || value.includes("pagado")) return "authorized";
    if (value.includes("parcial")) return "partial";
    if (value.includes("pendiente")) return "pending";
    if (value.includes("anulado")) return "cancelled";
    return "draft";
  }

  function filteredSales() {
    const search = String(state.salesFilters.search || "").toLowerCase();
    const status = state.salesFilters.status || "";
    return state.db.sales.filter(sale => {
      const haystack = [sale.document, sale.client, sale.country, sale.status, sale.sriStatus].join(" ").toLowerCase();
      return (!search || haystack.includes(search)) && (!status || sale.status === status);
    });
  }

  function render(container) {
    const rows = filteredSales();
    container.innerHTML = `
      <section class="section-head">
        <div>
          <h2>Ventas</h2>
          <p>Lista separada del formulario detalle. Esta es la base para facturacion, exportacion y cartera.</p>
        </div>
        <div class="topbar-actions">
          <button class="ghost-button" data-sales-action="refresh">Actualizar</button>
          <button class="primary-button" data-sales-action="new">Nueva venta</button>
        </div>
      </section>
      <article class="glass-card toolbar">
        <div class="field-stack">
          <label>Buscar</label>
          <input id="sales-search" placeholder="Documento, cliente, pais o estado" value="${esc(state.salesFilters.search)}">
        </div>
        <div class="field-stack">
          <label>Estado</label>
          <select id="sales-status-filter">
            <option value="">Todos</option>
            <option ${state.salesFilters.status === "Borrador" ? "selected" : ""}>Borrador</option>
            <option ${state.salesFilters.status === "Pendiente" ? "selected" : ""}>Pendiente</option>
            <option ${state.salesFilters.status === "Autorizado" ? "selected" : ""}>Autorizado</option>
            <option ${state.salesFilters.status === "Parcial" ? "selected" : ""}>Parcial</option>
            <option ${state.salesFilters.status === "Anulado" ? "selected" : ""}>Anulado</option>
          </select>
        </div>
        <div class="field-stack">
          <label>Total visible</label>
          <input value="${money(rows.reduce((sum, sale) => sum + Number(sale.total || 0), 0))}" readonly>
        </div>
        <div class="topbar-actions">
          <button class="secondary-button" data-sales-action="clear">Limpiar</button>
        </div>
      </article>
      <article class="glass-card table-card">
        <div class="table-head">
          <div>
            <h3>Documentos</h3>
            <p>${rows.length} registro(s) mostrados</p>
          </div>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Documento</th>
                <th>Cliente</th>
                <th>Pais</th>
                <th>Total</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              ${rows.length ? rows.map(sale => `
                <tr>
                  <td>${esc(sale.date)}</td>
                  <td><strong>${esc(sale.document)}</strong><small>${esc(sale.sriStatus || "Sin estado SRI")}</small></td>
                  <td><strong>${esc(sale.client)}</strong><small>${esc(sale.notes || "Sin observaciones")}</small></td>
                  <td>${esc(sale.country || "-")}</td>
                  <td><strong>${money(sale.total)}</strong></td>
                  <td><span class="status-badge ${statusClass(sale.status)}">${esc(sale.status)}</span></td>
                  <td>
                    <div class="row-actions">
                      <button class="action-link" data-sales-view="${esc(sale.id)}">Ver</button>
                      <button class="action-link" data-sales-edit="${esc(sale.id)}">Editar</button>
                      <button class="action-link danger" data-sales-delete="${esc(sale.id)}">Eliminar</button>
                    </div>
                  </td>
                </tr>
              `).join("") : `
                <tr><td colspan="7"><div class="empty-state">No hay ventas para los filtros actuales.</div></td></tr>
              `}
            </tbody>
          </table>
        </div>
      </article>
    `;

    bindPage(container);
  }

  function bindPage(container) {
    container.querySelector("#sales-search")?.addEventListener("input", event => {
      state.salesFilters.search = event.target.value || "";
      BlessERP.layout.renderCurrentPage();
    });

    container.querySelector("#sales-status-filter")?.addEventListener("change", event => {
      state.salesFilters.status = event.target.value || "";
      BlessERP.layout.renderCurrentPage();
    });

    container.querySelector('[data-sales-action="clear"]')?.addEventListener("click", () => {
      state.salesFilters.search = "";
      state.salesFilters.status = "";
      BlessERP.layout.renderCurrentPage();
    });

    container.querySelector('[data-sales-action="refresh"]')?.addEventListener("click", () => {
      BlessERP.layout.renderCurrentPage();
    });

    container.querySelector('[data-sales-action="new"]')?.addEventListener("click", () => {
      openDetail({ type: "sale", mode: "edit", record: createEmptySale(), tab: "document" });
      BlessERP.layout.renderDetail();
    });

    container.querySelectorAll("[data-sales-view]").forEach(button => button.addEventListener("click", () => {
      const record = state.db.sales.find(item => item.id === button.dataset.salesView);
      if (!record) return;
      openDetail({ type: "sale", mode: "view", record: BlessERP.utils.clone(record), tab: "document" });
      BlessERP.layout.renderDetail();
    }));

    container.querySelectorAll("[data-sales-edit]").forEach(button => button.addEventListener("click", () => {
      const record = state.db.sales.find(item => item.id === button.dataset.salesEdit);
      if (!record) return;
      openDetail({ type: "sale", mode: "edit", record: BlessERP.utils.clone(record), tab: "document" });
      BlessERP.layout.renderDetail();
    }));

    container.querySelectorAll("[data-sales-delete]").forEach(button => button.addEventListener("click", () => {
      const record = state.db.sales.find(item => item.id === button.dataset.salesDelete);
      if (!record) return;
      if (!window.confirm(`Eliminar la venta ${record.document}?`)) return;
      removeSale(record.id);
      BlessERP.layout.toast("Venta eliminada");
      BlessERP.layout.renderCurrentPage();
    }));
  }

  function detailTabButton(key, label, activeTab) {
    return `<button class="detail-tab ${activeTab === key ? "active" : ""}" data-detail-tab="${key}">${label}</button>`;
  }

  function saleLineRow(line) {
    return `
      <div class="line-item" data-line-id="${esc(line.id)}">
        <div class="field-stack">
          <label>Producto / variedad</label>
          <input data-line-field="product" value="${esc(line.product)}">
        </div>
        <div class="field-stack">
          <label>Cantidad</label>
          <input data-line-field="quantity" type="number" min="0" step="1" value="${esc(line.quantity)}">
        </div>
        <div class="field-stack">
          <label>Precio</label>
          <input data-line-field="price" type="number" min="0" step="0.01" value="${esc(line.price)}">
        </div>
        <div class="field-stack">
          <label>Total</label>
          <input value="${money(Number(line.quantity || 0) * Number(line.price || 0))}" readonly>
        </div>
        <button type="button" class="secondary-button" data-remove-line="${esc(line.id)}">Quitar</button>
      </div>
    `;
  }

  function renderDetail() {
    const detail = state.detail;
    if (!detail || detail.type !== "sale") return "";
    const sale = detail.record;
    const activeTab = detail.tab || "document";
    const readOnly = detail.mode === "view" ? "readonly" : "";
    const disabled = detail.mode === "view" ? "disabled" : "";

    const sections = {
      document: `
        <article class="glass-card detail-card span-12">
          <h3>Documento</h3>
          <p>Cabecera principal del comprobante.</p>
          <div class="form-grid">
            <div class="field-stack"><label>Numero</label><input name="document" value="${esc(sale.document)}" ${readOnly}></div>
            <div class="field-stack"><label>Fecha</label><input name="date" type="date" value="${esc(sale.date)}" ${readOnly}></div>
            <div class="field-stack"><label>Estado</label><select name="status" ${disabled}>
              <option ${sale.status === "Borrador" ? "selected" : ""}>Borrador</option>
              <option ${sale.status === "Pendiente" ? "selected" : ""}>Pendiente</option>
              <option ${sale.status === "Autorizado" ? "selected" : ""}>Autorizado</option>
              <option ${sale.status === "Parcial" ? "selected" : ""}>Parcial</option>
              <option ${sale.status === "Anulado" ? "selected" : ""}>Anulado</option>
            </select></div>
            <div class="field-stack"><label>Estado SRI</label><input name="sriStatus" value="${esc(sale.sriStatus || "")}" ${readOnly}></div>
          </div>
        </article>
      `,
      client: `
        <article class="glass-card detail-card span-12">
          <h3>Cliente</h3>
          <p>Datos comerciales y destino.</p>
          <div class="form-grid">
            <div class="field-stack"><label>Cliente</label><input name="client" value="${esc(sale.client)}" ${readOnly}></div>
            <div class="field-stack"><label>Pais</label><input name="country" value="${esc(sale.country)}" ${readOnly}></div>
            <div class="field-stack full"><label>Notas</label><textarea name="notes" rows="4" ${readOnly}>${esc(sale.notes || "")}</textarea></div>
          </div>
        </article>
      `,
      products: `
        <article class="glass-card detail-card span-12">
          <div class="section-head">
            <div>
              <h3>Productos y detalle</h3>
              <p>Linea comercial editable sin mezclarla con la lista principal.</p>
            </div>
            ${detail.mode === "edit" ? `<button type="button" class="secondary-button" data-add-line>Agregar linea</button>` : ""}
          </div>
          <div class="line-grid">
            ${(sale.lines || []).map(saleLineRow).join("")}
          </div>
        </article>
      `,
      logistics: `
        <article class="glass-card detail-card span-12">
          <h3>Logistica</h3>
          <p>Base operativa inicial para guia, packing y embarque.</p>
          <div class="form-grid">
            <div class="field-stack"><label>Estado logistico</label><select name="logisticsStatus" ${disabled}>
              <option ${sale.logisticsStatus === "Sin guia" ? "selected" : ""}>Sin guia</option>
              <option ${sale.logisticsStatus === "Guia generada" ? "selected" : ""}>Guia generada</option>
              <option ${sale.logisticsStatus === "Lista de empaque generada" ? "selected" : ""}>Lista de empaque generada</option>
            </select></div>
            <div class="field-stack"><label>Total calculado</label><input value="${money(sale.total)}" readonly></div>
          </div>
        </article>
      `,
      accounting: `
        <article class="glass-card detail-card span-12">
          <h3>Contabilidad</h3>
          <p>Espacio reservado para asiento, cartera y trazabilidad tributaria.</p>
          <div class="module-roadmap">
            <div class="roadmap-item"><strong>Estado</strong><span>${esc(sale.status)}</span></div>
            <div class="roadmap-item"><strong>SRI</strong><span>${esc(sale.sriStatus || "Sin dato")}</span></div>
            <div class="roadmap-item"><strong>Total</strong><span>${money(sale.total)}</span></div>
            <div class="roadmap-item"><strong>Siguiente fase</strong><span>Asiento contable y cartera enlazados</span></div>
          </div>
        </article>
      `
    };

    return `
      <div class="detail-dialog">
        <div class="detail-header">
          <div>
            <p class="eyebrow">VENTAS / DETALLE SEPARADO</p>
            <h2>${esc(sale.document || "Nueva venta")}</h2>
            <p>${detail.mode === "edit" ? "Formulario aparte y seguro para editar sin mezclar la tabla principal." : "Vista completa separada del listado."}</p>
          </div>
          <div class="detail-header-actions">
            <span class="status-badge ${statusClass(sale.status)}">${esc(sale.status)}</span>
            <button type="button" class="ghost-button" data-close-detail>Volver</button>
          </div>
        </div>
        <div class="detail-tabs">
          ${detailTabButton("document", "Documento", activeTab)}
          ${detailTabButton("client", "Cliente", activeTab)}
          ${detailTabButton("products", "Productos", activeTab)}
          ${detailTabButton("logistics", "Logistica", activeTab)}
          ${detailTabButton("accounting", "Contabilidad", activeTab)}
        </div>
        <div class="detail-content">
          <form id="sale-detail-form" class="detail-grid">
            ${sections[activeTab]}
          </form>
        </div>
        <div class="detail-footer">
          <span class="detail-footer-note">${detail.mode === "edit" ? "La navegacion valida cambios pendientes antes de salir." : "Puede volver al listado sin perder contexto."}</span>
          <div class="topbar-actions">
            ${detail.mode === "edit" ? `<button type="button" class="secondary-button" data-save-sale>Guardar cambios</button>` : ""}
          </div>
        </div>
      </div>
    `;
  }

  function bindDetail(container) {
    const detail = state.detail;
    if (!detail || detail.type !== "sale") return;
    const sale = detail.record;

    container.querySelectorAll("[data-detail-tab]").forEach(button => button.addEventListener("click", () => {
      detail.tab = button.dataset.detailTab;
      BlessERP.layout.renderDetail();
    }));

    container.querySelector("[data-close-detail]")?.addEventListener("click", () => {
      if (!closeDetail()) return;
      BlessERP.layout.renderDetail();
    });

    container.querySelectorAll("#sale-detail-form input, #sale-detail-form select, #sale-detail-form textarea").forEach(field => {
      field.addEventListener("input", () => {
        if (field.name) sale[field.name] = field.value;
        markDirty(true);
      });
      field.addEventListener("change", () => {
        if (field.name) sale[field.name] = field.value;
        markDirty(true);
      });
    });

    container.querySelector("[data-add-line]")?.addEventListener("click", () => {
      sale.lines.push({ id: BlessERP.utils.uid("LIN"), product: "", quantity: 1, price: 0, total: 0 });
      markDirty(true);
      BlessERP.layout.renderDetail();
    });

    container.querySelectorAll("[data-remove-line]").forEach(button => button.addEventListener("click", () => {
      sale.lines = sale.lines.filter(line => line.id !== button.dataset.removeLine);
      if (!sale.lines.length) sale.lines.push({ id: BlessERP.utils.uid("LIN"), product: "", quantity: 1, price: 0, total: 0 });
      markDirty(true);
      BlessERP.layout.renderDetail();
    }));

    container.querySelectorAll("[data-line-id]").forEach(row => {
      const line = sale.lines.find(item => item.id === row.dataset.lineId);
      if (!line) return;
      row.querySelectorAll("[data-line-field]").forEach(field => field.addEventListener("input", () => {
        line[field.dataset.lineField] = field.type === "number" ? Number(field.value || 0) : field.value;
        markDirty(true);
      }));
    });

    container.querySelector("[data-save-sale]")?.addEventListener("click", () => {
      if (!sale.client.trim()) {
        BlessERP.layout.toast("Ingrese el cliente de la venta");
        return;
      }
      if (!sale.document.trim()) {
        BlessERP.layout.toast("Ingrese el numero del documento");
        return;
      }
      upsertSale(sale);
      detail.mode = "view";
      BlessERP.layout.toast("Venta guardada correctamente");
      BlessERP.layout.renderCurrentPage();
      BlessERP.layout.renderDetail();
    });
  }

  BlessERP.modules = BlessERP.modules || {};
  BlessERP.modules.sales = { render, renderDetail, bindDetail };
})();
