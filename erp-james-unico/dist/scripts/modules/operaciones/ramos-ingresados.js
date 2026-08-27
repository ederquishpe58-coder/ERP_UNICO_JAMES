(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};

  function ecuadorToday() {
    try {
      return new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Guayaquil",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      }).format(new Date());
    } catch (_) {
      return new Date().toISOString().slice(0, 10);
    }
  }

  const view = {
    open: false,
    queried: false,
    loading: false,
    error: "",
    rows: [],
    total: 0,
    page: 1,
    pageSize: 25,
    filters: {
      from: ecuadorToday(),
      to: ecuadorToday(),
      code: "",
      supplier: "",
      variety: "",
      measure: ""
    }
  };

  function getState() {
    return {
      ...view,
      filters: { ...view.filters },
      rows: view.rows.map(item => ({ ...item }))
    };
  }

  function isOpen() {
    return view.open;
  }

  function open() {
    view.open = true;
    view.queried = false;
    view.loading = false;
    view.error = "";
    view.rows = [];
    view.total = 0;
    view.page = 1;
  }

  function close() {
    view.open = false;
    view.loading = false;
  }

  function setFilter(field, value) {
    if (field === "pageSize") {
      view.pageSize = [25, 50].includes(Number(value)) ? Number(value) : 25;
      view.page = 1;
      return;
    }
    if (!Object.prototype.hasOwnProperty.call(view.filters, field)) return;
    view.filters[field] = String(value || "");
    view.page = 1;
  }

  async function query(page = 1) {
    if (view.loading) return { ok: false, ignored: true };
    view.loading = true;
    view.error = "";
    view.page = Math.max(1, Number(page || 1));
    const repository = BlessERP.getZebraV2Repository?.();
    if (!repository?.listBunchEntryHistory) {
      view.loading = false;
      view.queried = true;
      view.error = "El repositorio de historial Zebra no está disponible.";
      return { ok: false, message: view.error };
    }
    const result = await repository.listBunchEntryHistory({
      ...view.filters,
      page: view.page,
      pageSize: view.pageSize
    });
    view.loading = false;
    view.queried = true;
    if (!result?.ok) {
      view.rows = [];
      view.total = 0;
      view.error = result?.message || "No se pudo consultar el historial Zebra.";
      return result || { ok: false, message: view.error };
    }
    view.rows = Array.isArray(result.rows) ? result.rows : [];
    view.total = Number(result.total || 0);
    view.page = Number(result.page || view.page);
    view.pageSize = Number(result.pageSize || view.pageSize);
    return result;
  }

  function render() {
    if (!view.open) return "";
    const utils = BlessERP.operacionesUtils;
    const totalPages = Math.max(1, Math.ceil(view.total / view.pageSize));
    const start = view.total ? ((view.page - 1) * view.pageSize) + 1 : 0;
    const end = Math.min(view.total, view.page * view.pageSize);
    return `
      <section class="panel-card ops-zebra-history" data-ops-zebra-history>
        <div class="panel-card-head">
          <div><p class="section-kicker">CONSULTA BAJO DEMANDA</p><h3>Historial de Ramos Zebra</h3><p>El historial se consulta únicamente al pulsar Consultar.</p></div>
          <button class="secondary-button" type="button" data-ops-action="bunch-history-close">Cerrar historial</button>
        </div>
        <div class="ops-zebra-history-filters">
          <label class="compact-inline-field"><span>Desde</span><input type="date" value="${utils.esc(view.filters.from)}" data-ops-bunch-history-field="from"></label>
          <label class="compact-inline-field"><span>Hasta</span><input type="date" value="${utils.esc(view.filters.to)}" data-ops-bunch-history-field="to"></label>
          <label class="compact-inline-field"><span>Código Zebra</span><input value="${utils.esc(view.filters.code)}" data-ops-bunch-history-field="code" placeholder="0000000000"></label>
          <label class="compact-inline-field"><span>Proveedor</span><input value="${utils.esc(view.filters.supplier)}" data-ops-bunch-history-field="supplier"></label>
          <label class="compact-inline-field"><span>Variedad</span><input value="${utils.esc(view.filters.variety)}" data-ops-bunch-history-field="variety"></label>
          <label class="compact-inline-field"><span>Medida</span><input inputmode="numeric" value="${utils.esc(view.filters.measure)}" data-ops-bunch-history-field="measure" placeholder="60"></label>
          <label class="compact-inline-field"><span>Registros</span><select data-ops-bunch-history-field="pageSize"><option value="25" ${view.pageSize === 25 ? "selected" : ""}>25</option><option value="50" ${view.pageSize === 50 ? "selected" : ""}>50</option></select></label>
          <button class="primary-button" type="button" data-ops-action="bunch-history-query" ${view.loading ? "disabled" : ""}>${view.loading ? "Consultando..." : "Consultar"}</button>
        </div>
        ${view.error ? `<div class="inline-feedback danger"><strong>No se pudo consultar</strong> · ${utils.esc(view.error)}</div>` : ""}
        ${!view.queried ? `<div class="ops-zebra-history-empty"><strong>Sin consulta ejecutada</strong><span>Defina los filtros y pulse Consultar.</span></div>` : `
          <div class="compact-table-wrap"><table class="compact-table">
            <thead><tr><th>Fecha/hora</th><th>Código</th><th>Proveedor</th><th>Variedad</th><th>Medida</th><th>Tallos</th><th>Embonchador</th><th>Inventario</th><th>Estado</th></tr></thead>
            <tbody>${view.rows.map(item => `<tr>
              <td>${utils.esc(item.registeredAt || item.canonicalCreatedAt || "-")}</td>
              <td><strong>${utils.esc(item.code || item.labelCode || "-")}</strong></td>
              <td>${utils.esc(item.supplier || "-")}<br><small>${utils.esc(item.block || "")}</small></td>
              <td>${utils.esc(item.variety || "-")}</td>
              <td>${utils.esc(item.length || "-")} cm</td>
              <td>${utils.number(item.stemsPerBunch || item.stems || 0)}</td>
              <td>${utils.esc(item.buncher || "-")}</td>
              <td>${utils.esc(item.inventoryId || "-")}</td>
              <td><span class="status-badge ${utils.badgeClass(item.operationalState || item.state)}">${utils.esc(item.operationalState || item.state || "-")}</span></td>
            </tr>`).join("") || `<tr><td colspan="9">No existen ingresos para los filtros seleccionados.</td></tr>`}</tbody>
          </table></div>
          <div class="erp-pagination ops-zebra-history-pagination">
            <span>${utils.number(start)}–${utils.number(end)} de ${utils.number(view.total)}</span>
            <button class="secondary-button" type="button" data-ops-action="bunch-history-page" data-page="${view.page - 1}" ${view.page <= 1 || view.loading ? "disabled" : ""}>Anterior</button>
            <strong>Página ${utils.number(view.page)} de ${utils.number(totalPages)}</strong>
            <button class="secondary-button" type="button" data-ops-action="bunch-history-page" data-page="${view.page + 1}" ${view.page >= totalPages || view.loading ? "disabled" : ""}>Siguiente</button>
          </div>
        `}
      </section>
    `;
  }

  BlessERP.operacionesRamosIngresados = { close, getState, isOpen, open, query, render, setFilter };
})();
