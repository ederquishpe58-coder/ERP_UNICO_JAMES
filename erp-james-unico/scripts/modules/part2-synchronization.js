(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const { esc } = BlessERP.utils;
  const uiState = { rows: [], loading: false, error: "", message: "", status: "" };

  function context() {
    const access = BlessERP.authAccess?.activeAccess?.() || {};
    return {
      companyId: access.activeCompany?.id || BlessERP.state?.state?.db?.authAccess?.activeCompanyUuid || "",
      userId: access.session?.user?.id || BlessERP.state?.state?.db?.session?.activeUser?.id || ""
    };
  }

  function statusLabel(value) {
    const labels = { pending: "Pendiente", syncing: "Sincronizando", synced: "Sincronizado", error: "Error", conflict: "Conflicto auditado" };
    return labels[String(value || "").toLowerCase()] || String(value || "Pendiente");
  }

  function statusClass(value) {
    const state = String(value || "").toLowerCase();
    if (state === "conflict" || state === "error") return "cancelled";
    if (state === "synced") return "authorized";
    return "pending";
  }

  function formatDate(value) {
    if (!value) return "-";
    try { return new Date(value).toLocaleString("es-EC", { timeZone: "America/Guayaquil" }); } catch { return String(value); }
  }

  function serverRecord(row) {
    return row.server_record || row.conflict_details?.server_record || null;
  }

  function differentFields(row) {
    const local = row.payload || row.conflict_details?.local_payload || {};
    const remote = serverRecord(row)?.payload || row.conflict_details?.server_payload || {};
    const keys = new Set([...Object.keys(local || {}), ...Object.keys(remote || {})]);
    return [...keys].filter(key => JSON.stringify(local?.[key]) !== JSON.stringify(remote?.[key])).map(key => ({
      key,
      local: local?.[key],
      remote: remote?.[key]
    }));
  }

  async function remoteRows() {
    const client = BlessERP.getSupabaseClient?.();
    const { companyId } = context();
    if (!client || !companyId || !BlessERP.offlineSync?.status?.().enabled) return [];
    const { data, error } = await client
      .from("erp_sync_operations")
      .select("operation_id, company_id, entity, action, record_id, payload, user_id, device_id, local_created_at, attempts, status, last_error, server_created_at, server_processed_at, result_version, conflict_details")
      .eq("company_id", companyId)
      .in("status", ["PENDING", "SYNCING", "SYNCED", "ERROR", "CONFLICT"])
      .order("server_created_at", { ascending: false })
      .limit(250);
    if (error) throw error;
    return (data || []).map(row => ({
      ...row,
      status: String(row.status || "").toLowerCase(),
      server_confirmed_at: row.server_processed_at || row.server_created_at || "",
      source: "SUPABASE"
    }));
  }

  async function loadRows() {
    uiState.loading = true;
    uiState.error = "";
    BlessERP.layout.renderPage();
    try {
      const local = await BlessERP.syncIndexedDb.listOperations();
      let remote = [];
      try { remote = await remoteRows(); } catch (error) {
        uiState.error = `No se pudo consultar la cola remota: ${error?.message || error}`;
      }
      const merged = new Map(remote.map(row => [row.operation_id, row]));
      local.forEach(row => merged.set(row.operation_id, { ...(merged.get(row.operation_id) || {}), ...row, source: "LOCAL" }));
      uiState.rows = [...merged.values()].sort((a, b) => String(b.local_created_at || b.server_created_at || "").localeCompare(String(a.local_created_at || a.server_created_at || "")));
    } finally {
      uiState.loading = false;
      BlessERP.layout.renderPage();
    }
  }

  function renderDifferences(row) {
    const fields = differentFields(row);
    if (!fields.length) return `<div class="empty-inline">No hay diferencias de campos disponibles.</div>`;
    return `
      <table class="compact-table sync-differences-table">
        <thead><tr><th>Campo</th><th>Versión local</th><th>Versión Supabase</th></tr></thead>
        <tbody>${fields.map(item => `<tr><td><strong>${esc(item.key)}</strong></td><td><code>${esc(JSON.stringify(item.local))}</code></td><td><code>${esc(JSON.stringify(item.remote))}</code></td></tr>`).join("")}</tbody>
      </table>
    `;
  }

  function render(container, route) {
    const status = BlessERP.offlineSync?.status?.() || {};
    const rows = uiState.status ? uiState.rows.filter(row => String(row.status || "").toLowerCase() === uiState.status) : uiState.rows;
    container.innerHTML = `
      <section class="page-header">
        <div><p class="section-kicker">CONFIGURACIÓN</p><h1>Sincronización</h1><p>Cola automática por registro. Supabase es la fuente oficial y los conflictos se concilian sin bloquear al usuario.</p></div>
        <div class="page-header-side"><span class="status-badge ${statusClass(status.phase)}">${esc(statusLabel(status.phase || "local"))}</span></div>
      </section>
      ${uiState.error ? `<section class="inline-feedback danger">${esc(uiState.error)}</section>` : ""}
      <section class="summary-grid sync-summary-grid">
        <article class="summary-card"><span>Pendientes</span><strong>${esc(String(status.pendingCount || 0))}</strong><small>Operaciones por confirmar</small></article>
        <article class="summary-card"><span>Conflictos</span><strong>${esc(String(status.conflictCount || 0))}</strong><small>Conciliación automática y auditoría</small></article>
        <article class="summary-card"><span>Errores</span><strong>${esc(String(status.errorCount || 0))}</strong><small>Con detalle técnico</small></article>
        <article class="summary-card"><span>Última sincronización</span><strong class="sync-last-time">${esc(formatDate(status.lastSyncAt))}</strong><small>${esc(status.realtimeState || "CLOSED")}</small></article>
      </section>
      <section class="panel-card compact-toolbar-card">
        <div class="compact-toolbar">
          <label class="compact-inline-field"><span>Estado</span><select id="sync-center-status"><option value="">Todos</option>${["pending","syncing","synced","error","conflict"].map(value => `<option value="${value}" ${uiState.status === value ? "selected" : ""}>${statusLabel(value)}</option>`).join("")}</select></label>
          <div class="compact-toolbar-actions">
            <button class="primary-button" type="button" data-sync-center-now>Sincronizar ahora</button>
          <button class="secondary-button" type="button" data-sync-center-retry>Reintentar registros pendientes</button>
            <button class="secondary-button" type="button" data-sync-center-export>Exportar respaldo local</button>
          </div>
        </div>
      </section>
      <section class="panel-card">
        <div class="panel-card-head"><div><p class="section-kicker">COLA</p><h3>Operaciones y conflictos</h3></div><span class="status-badge partial">${esc(String(rows.length))} registros</span></div>
        <div class="compact-table-wrap">
          <table class="compact-table sync-center-table">
            <thead><tr><th>Estado</th><th>Módulo / registro</th><th>Cambio local</th><th>Versión Supabase</th><th>Usuario / dispositivo</th><th>Motivo</th><th>Acciones</th></tr></thead>
            <tbody>${rows.map(row => `
              <tr>
                <td>${`<span class="status-badge ${statusClass(row.status)}">${esc(statusLabel(row.status))}</span>`}</td>
                <td><strong>${esc(row.entity || "-")}</strong><small>${esc(row.record_id || row.operation_id || "-")}</small></td>
                <td>${esc(formatDate(row.local_created_at))}</td>
                <td>${esc(formatDate(serverRecord(row)?.updated_at || row.server_confirmed_at || row.server_processed_at))}</td>
                <td>${esc(row.user_id || "-")}<small>${esc(row.device_id || "-")}</small></td>
                <td>${esc(row.last_error || row.conflict_details?.message || "-")}</td>
                <td><div class="row-actions">
                  ${["pending","error"].includes(row.status) ? `<button class="row-action-button" data-sync-retry-one="${esc(row.operation_id)}">Reintentar</button>` : ""}
                </div></td>
              </tr>
              ${row.status === "conflict" ? `<tr class="sync-conflict-detail"><td colspan="7"><details><summary>Auditoría de campos diferentes</summary>${renderDifferences(row)}</details></td></tr>` : ""}
            `).join("") || `<tr><td colspan="7"><div class="empty-inline">No existen operaciones con este filtro.</div></td></tr>`}</tbody>
          </table>
        </div>
      </section>
    `;
    bind(container);
  }

  async function resolve(operationId, mode) {
    uiState.error = "";
    const row = uiState.rows.find(item => item.operation_id === operationId);
    let result;
    if (row?.entity === "erp_company_state") {
      result = await BlessERP.cloudStateSync?.resolveConflict?.(mode, BlessERP.state?.state?.db);
      if (result?.ok) await BlessERP.offlineSync.resolveConflict(operationId, "server");
    } else {
      result = await BlessERP.offlineSync.resolveConflict(operationId, mode);
    }
    if (!result?.ok) uiState.error = result?.message || "No se pudo resolver el conflicto.";
    await loadRows();
  }

  function exportBackup() {
    const payload = {
      exported_at: new Date().toISOString(),
      device_context: context(),
      operations: uiState.rows,
      local_database: BlessERP.state?.state?.db || null
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `jaeder-respaldo-sincronizacion-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function bind(container) {
    container.querySelector("#sync-center-status")?.addEventListener("change", event => { uiState.status = event.target.value; BlessERP.layout.renderPage(); });
    container.querySelector("[data-sync-center-now]")?.addEventListener("click", async () => { await BlessERP.offlineSync.retryNow(); await loadRows(); });
    container.querySelector("[data-sync-center-retry]")?.addEventListener("click", async () => { await BlessERP.offlineSync.processQueue(); await loadRows(); });
    container.querySelector("[data-sync-center-export]")?.addEventListener("click", exportBackup);
    container.querySelectorAll("[data-sync-retry-one]").forEach(button => button.addEventListener("click", async () => {
      await BlessERP.syncIndexedDb.updateOperation(button.dataset.syncRetryOne, { status: "pending", attempts: 0, last_error: "", next_retry_at: "" });
      await BlessERP.offlineSync.processQueue();
      await loadRows();
    }));
  }

  function open(container, route) {
    render(container, route);
    if (!uiState.loading && !uiState.rows.length) window.setTimeout(loadRows, 0);
  }

  BlessERP.modules = BlessERP.modules || {};
  BlessERP.modules.part2Synchronization = { loadRows, render: open };
})();
