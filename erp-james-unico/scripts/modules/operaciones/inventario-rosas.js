(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const stateApi = BlessERP.operacionesState;
  const utils = BlessERP.operacionesUtils;

  function buildRows(appState) {
    const store = stateApi.getStore(appState);
    return (store.roseInventory || [])
      .filter(item => item.sourceType === "ESCANEO_ETIQUETA" || item.sourceScannerEventId || item.sourceBunchEntryId)
      .map(item => {
        const hasComposition = Array.isArray(item.composition) && item.composition.length;
        const supplierList = hasComposition
          ? [...new Set(item.composition.map(line => line.supplier).filter(Boolean))]
          : [item.supplier].filter(Boolean);
        return {
          labelCode: item.labelCode || "-",
          blocks: hasComposition
            ? [...new Set(item.composition.map(line => line.block).filter(Boolean))].join(" + ")
            : (item.block || "-"),
          supplierList,
          suppliers: supplierList.join(" + ") || "-",
          variety: item.variety || "-",
          quality: BlessERP.flowerQuality?.preserve?.(item.quality) || "",
          buncher: item.buncher || "-",
          length: Number(item.length || 0),
          stems: Number(item.stemsPerBunch || item.stems || 0),
          admittedAt: item.admittedAt || item.date || "-",
          state: item.state || "DISPONIBLE"
        };
      })
      .sort((left, right) => String(right.admittedAt).localeCompare(String(left.admittedAt)));
  }

  function filterRows(rows, filters = {}) {
    const search = String(filters.search || "").trim().toUpperCase();
    const date = String(filters.date || "").trim();
    return rows.filter(item => {
      const admissionDate = String(item.admittedAt || "").slice(0, 10);
      if (date && admissionDate !== date) return false;
      if (filters.supplier && !item.supplierList.includes(filters.supplier)) return false;
      if (filters.variety && item.variety !== filters.variety) return false;
      if (filters.buncher && item.buncher !== filters.buncher) return false;
      if (!search) return true;
      const searchable = [item.labelCode, item.blocks, item.suppliers, item.variety, item.quality, BlessERP.flowerQuality?.label?.(item.quality), item.buncher, item.length, item.stems]
        .map(value => String(value || "").toUpperCase())
        .join(" ");
      return searchable.includes(search);
    });
  }

  function uniqueValues(rows, field) {
    const values = field === "supplier"
      ? rows.flatMap(item => item.supplierList || [])
      : rows.map(item => item[field]);
    return [...new Set(values.filter(Boolean))].sort((left, right) => String(left).localeCompare(String(right), "es", { sensitivity: "base" }));
  }

  function optionList(values, selected) {
    return values.map(value => `<option value="${utils.esc(value)}" ${String(value) === String(selected) ? "selected" : ""}>${utils.esc(value)}</option>`).join("");
  }

  function formatAdmissionDate(value) {
    const normalized = String(value || "-").replace("T", " ");
    return normalized === "-" ? normalized : normalized.slice(0, 16);
  }

  function render(appState) {
    const ui = stateApi.getUi(appState);
    const allRows = buildRows(appState);
    const filters = {
      search: ui.roseInventorySearch || "",
      supplier: ui.roseInventorySupplier || "",
      variety: ui.roseInventoryVariety || "",
      buncher: ui.roseInventoryBuncher || "",
      date: ui.roseInventoryDate || ""
    };
    const rows = filterRows(allRows, filters);
    const page = BlessERP.performance?.paginate?.(rows, "operations-rose-inventory", { pageSize: 75 })
      || { items: rows, total: rows.length, pageSize: rows.length || 1 };
    const filtersActive = Boolean(filters.search || filters.supplier || filters.variety || filters.buncher || filters.date);
    const historyOpen = ui.meshHistoryOpen;
    const supplierReportOpen = ui.inventorySupplierReportOpen;
    return `
      <div class="ops-inventory-top-actions">
        <div class="ops-yield-options-bar ops-inventory-options-bar">
          <details class="ops-yield-options-menu ops-inventory-options-menu">
            <summary>Opciones</summary>
            <div>
              <button type="button" data-ops-action="inventory-supplier-report">Reportes de proveedores</button>
              <button type="button" data-ops-action="mesh-history-toggle">Historial de mallas procesadas</button>
            </div>
          </details>
        </div>
        ${historyOpen ? `<button class="secondary-button" type="button" data-ops-action="mesh-history-toggle">&larr; Volver al inventario de rosas</button>` : ""}
        ${supplierReportOpen ? `<button class="secondary-button" type="button" data-ops-action="inventory-supplier-report-close">&larr; Volver al inventario de rosas</button>` : ""}
      </div>
      ${supplierReportOpen ? `
        ${BlessERP.operacionesInventarioProveedoresReport.renderSupplierClassificationReport(appState)}
      ` : historyOpen ? `
        ${BlessERP.operacionesHistorialMallas.render(appState)}
      ` : `
      <section class="panel-card ops-rose-inventory-panel">
        <div class="panel-card-head">
          <div>
            <p class="section-kicker">INVENTARIO DE ROSAS</p>
            <h3>Ramos ingresados por esc&aacute;ner</h3>
          </div>
          <span class="status-badge authorized">${utils.esc(utils.number(rows.length))}${filtersActive ? ` de ${utils.esc(utils.number(allRows.length))}` : ""} ramo(s)</span>
        </div>
        <div class="ops-rose-inventory-filters" aria-label="Filtros del inventario de rosas">
          <label class="compact-inline-field"><span>Buscar ramo</span><input type="search" autocomplete="off" placeholder="C&oacute;digo, bloque, proveedor, variedad o embonchador" data-ops-ui-field="roseInventorySearch" value="${utils.esc(filters.search)}"></label>
          <label class="compact-inline-field"><span>Proveedor</span><select data-ops-ui-field="roseInventorySupplier"><option value="">Todos</option>${optionList(uniqueValues(allRows, "supplier"), filters.supplier)}</select></label>
          <label class="compact-inline-field"><span>Variedad</span><select data-ops-ui-field="roseInventoryVariety"><option value="">Todas</option>${optionList(uniqueValues(allRows, "variety"), filters.variety)}</select></label>
          <label class="compact-inline-field"><span>Embonchador</span><select data-ops-ui-field="roseInventoryBuncher"><option value="">Todos</option>${optionList(uniqueValues(allRows, "buncher"), filters.buncher)}</select></label>
          <label class="compact-inline-field"><span>Fecha de ingreso</span><input type="date" data-ops-ui-field="roseInventoryDate" value="${utils.esc(filters.date)}"></label>
          <button class="secondary-button" type="button" data-ops-action="rose-inventory-clear-filters" ${filtersActive ? "" : "disabled"}>Limpiar filtros</button>
        </div>
        <div class="compact-table-wrap">
          <table class="compact-table ops-rose-inventory-table" aria-label="Inventario de rosas ingresado por escaner">
            <thead>
              <tr>
                <th>C&oacute;digo de etiqueta</th>
                <th>Bloques</th>
                <th>Variedad</th>
                <th>Calidad</th>
                <th>Embonchador</th>
                <th>Medida</th>
                <th>N&uacute;mero de tallos</th>
                <th>Fecha de ingreso de ramos</th>
                <th>Estado operativo</th>
              </tr>
            </thead>
            <tbody>
              ${page.items.map(item => `
                <tr>
                  <td><strong>${utils.esc(item.labelCode)}</strong></td>
                  <td>${utils.esc(item.blocks)}</td>
                  <td>${utils.esc(item.variety)}</td>
                  <td><strong>${utils.esc(BlessERP.flowerQuality?.label?.(item.quality) || "SIN CALIDAD")}</strong></td>
                  <td>${utils.esc(item.buncher)}</td>
                  <td>${utils.esc(utils.number(item.length))} cm</td>
                  <td>${utils.esc(utils.number(item.stems))}</td>
                  <td>${utils.esc(formatAdmissionDate(item.admittedAt))}</td>
                  <td><span class="status-badge ${utils.badgeClass(item.state)}">${utils.esc(item.state)}</span></td>
                </tr>
              `).join("") || `<tr><td colspan="9"><div class="empty-inline">${filtersActive ? "No existen ramos que coincidan con los filtros seleccionados." : "No existen ramos ingresados por esc&aacute;ner."}</div></td></tr>`}
            </tbody>
          </table>
        </div>
        ${BlessERP.performance?.renderPager?.(page) || ""}
      </section>
      `}
    `;
  }

  BlessERP.operacionesInventario = { buildRows, filterRows, uniqueValues, render };
})();
